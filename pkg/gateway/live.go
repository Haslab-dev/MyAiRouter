package gateway

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// Live activity tracking — the data behind the Overview "running" animation.
//
// The dashboard's Live Activity card already knows how to answer "what just
// finished" (usageHistory). It cannot answer "what is happening right now":
// usage rows are only written when a request ends, so a combo that is still
// racing, a stream that is still emitting tokens, or a request that is stuck
// waiting on an upstream all look like silence.
//
// This tracker is that missing half. It is deliberately in-memory and
// lock-scoped to microseconds: a request touches it a handful of times
// (start, route resolved, upstream attempt, idle, finalize) and every write
// is a map lookup plus a few field assignments. Nothing is persisted, so a
// restart simply starts clean — the animation is cosmetic and must never be
// able to slow the gateway down or fail a request.
//
// Every entry point is nil-safe on purpose: if a test builds a GatewayContext
// without calling BeginActivity, the hooks are no-ops.
type ActivityTracker struct {
	mu       sync.Mutex
	sessions map[string]*activitySession
	sum      activitySum
}

type activitySession struct {
	id           string
	model        string
	originalMod  string
	provider     string
	combo        string
	kind         string
	stream       bool
	started      time.Time
	lastStep     time.Time
	step         string
	stepCount    int
	targets      int
	attempt      int
	inflight     int
	ok           bool
	done         bool
	endedAt      time.Time
	errText      string
	responseCode int
	ttfbMs       int64
	tps          float64
	promptTokens int
	completion   int
	outTokens    int
	lastOutput   time.Time
}

// activitySum is the cheap aggregate the sidebar animation needs: it must not
// walk the session map on every poll.
// No `streams` or `waiting` counter here on purpose: both are derived in
// Snapshot. A maintained counter drifts as soon as a losing parallel attempt
// outlives the request that spawned it, and a wrong number in an animation is
// worse than a recomputed one.
type activitySum struct {
	rps     float64
	tps     float64
	active  int
	errors  int
	retries int
}

var liveActivity = &ActivityTracker{sessions: make(map[string]*activitySession)}

const (
	// A session is reported as running while it has not finalized. A request
	// that has produced no token for this long is reported as "waiting"
	// instead, so the UI can show a stalled/hung upstream without lying.
	activityStallGrace = 8 * time.Second

	// Completed sessions linger briefly so the UI can render the "finished"
	// blink without needing its own bookkeeping.
	activityGrace = 4 * time.Second

	// Hard cap on retained sessions, as a safety net: if finalization is ever
	// missed the map must not grow without bound.
	activityMaxSessions = 200
)

func nowUTC() time.Time { return time.Now() }

// SetStep updates the human-readable stage label on a live session (the
// Overview animation renders it as the current step). No-op for an
// untracked/unknown id.
func SetStep(id, step string) {
	liveActivity.update(id, func(s *activitySession) {
		s.setStep(step, nowUTC())
	})
}

// BeginActivity opens a live activity record for a request. Returns the key
// used by every later call; empty string means "not tracked" (callers treat
// that as a no-op).
func BeginActivity(id, model, endpoint string) string {
	if id == "" {
		return ""
	}
	t := nowUTC()
	liveActivity.mu.Lock()
	defer liveActivity.mu.Unlock()
	liveActivity.reapLocked(t)

	liveActivity.sessions[id] = &activitySession{
		id:       id,
		model:    model,
		started:  t,
		lastStep: t,
		step:     "Received",
	}
	liveActivity.sum.active++
	return id
}

// ComboResolved records the route the request resolved to: the upstream
// targets it will try, the combo kind and the strategy name.
func ComboResolved(id, originalModel, comboName, comboKind string, targets int) {
	liveActivity.update(id, func(s *activitySession) {
		s.originalMod = originalModel
		if comboName != "" {
			s.combo = comboName
		}
		if comboKind != "" {
			s.kind = comboKind
		}
		if targets > 0 {
			s.targets = targets
		}
		s.setStep("Routed", nowUTC())
	})
}

// SetTargets records the number of concrete upstream targets after the
// routing middleware expanded the combo into connections.
func SetTargets(id string, n int) {
	liveActivity.update(id, func(s *activitySession) {
		if n > 0 {
			s.targets = n
		}
	})
}

// AttemptStarted marks that the request is now talking to one upstream
// account. inflight counts concurrent attempts, so a parallel/race combo
// reports the real fan-out instead of a single request.
func AttemptStarted(id, provider, model string, attempt int) {
	t := nowUTC()
	liveActivity.update(id, func(s *activitySession) {
		if provider != "" {
			s.provider = provider
		}
		if model != "" {
			s.model = model
		}
		if attempt > 0 {
			s.attempt = attempt
		}
		s.inflight++
		s.setStep("Upstream", t)
	})
}

// AttemptFinished closes an in-flight attempt.
func AttemptFinished(id string) {
	liveActivity.update(id, func(s *activitySession) {
		if s.inflight > 0 {
			s.inflight--
		}
	})
}

// MarkStream flags the request as an SSE stream once the upstream response
// turns out to be one.
func MarkStream(id string, stream bool) {
	if !stream {
		return
	}
	liveActivity.update(id, func(s *activitySession) {
		s.stream = true
		s.setStep("Streaming", nowUTC())
	})
}

// FirstToken records time-to-first-token.
func FirstToken(id string, ttfb time.Duration) {
	liveActivity.update(id, func(s *activitySession) {
		s.ttfbMs = ttfb.Milliseconds()
		s.setStep("Streaming", nowUTC())
	})
}

// OutputBytes accumulates generated bytes as they stream to the client, so
// the UI can render live tokens/s instead of a static "running" badge.
func OutputBytes(id string, n int) {
	if n <= 0 {
		return
	}
	liveActivity.update(id, func(s *activitySession) {
		s.outTokens += n
		s.lastOutput = nowUTC()
	})
}

// FinishActivity closes the record: the response is on the wire and the
// request is done. Kept separate from BeginActivity so an early return
// inside a middleware can still finalize.
func FinishActivity(id string, responseCode int, ok bool, promptTokens, completionTokens, cachedTokens int) {
	liveActivity.finish(id, responseCode, ok, promptTokens, completionTokens, cachedTokens, "")
}

// FinishActivityWithError finalizes and attaches the failure text, which is
// what makes "why is it red" answerable from the Overview card.
func FinishActivityWithError(id string, responseCode int, errText string) {
	liveActivity.finish(id, responseCode, false, 0, 0, 0, errText)
}

func (t *ActivityTracker) finish(id string, responseCode int, ok bool, promptTokens, completionTokens, cachedTokens int, errText string) {
	if id == "" {
		return
	}
	now := nowUTC()
	t.mu.Lock()
	defer t.mu.Unlock()

	s, exists := t.sessions[id]
	if !exists {
		return
	}
	if s.done {
		return
	}
	s.done = true
	s.ok = ok
	s.responseCode = responseCode
	s.promptTokens = promptTokens
	s.completion = completionTokens
	s.endedAt = now
	s.errText = errText
	dur := now.Sub(s.started).Seconds()
	if dur > 0 {
		s.tps = round1(float64(promptTokens+completionTokens) / dur)
	}
	s.setStep("Done", now)

	s.inflight = 0
	if t.sum.active > 0 {
		t.sum.active--
	}
	if !ok {
		t.sum.errors++
	}
	t.reapLocked(now)
}

// update applies fn to the tracked session, if any. Every instrumentation
// call site uses this so a missing/untracked request is silently ignored.
func (t *ActivityTracker) update(id string, fn func(*activitySession)) {
	if id == "" {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if s, ok := t.sessions[id]; ok && !s.done {
		fn(s)
	}
}

// reapLocked drops finished sessions after the grace window and enforces the
// hard cap (oldest first) so a missed finalize cannot leak.
func (t *ActivityTracker) reapLocked(now time.Time) {
	for id, s := range t.sessions {
		if s.done && !s.endedAt.IsZero() && now.Sub(s.endedAt) > activityGrace {
			delete(t.sessions, id)
		}
	}
	if len(t.sessions) <= activityMaxSessions {
		return
	}
	var oldest string
	var oldestT time.Time
	for id, s := range t.sessions {
		if oldest == "" || s.started.Before(oldestT) {
			oldest, oldestT = id, s.started
		}
	}
	if oldest != "" {
		if s := t.sessions[oldest]; s != nil {
			if !s.done && t.sum.active > 0 {
				t.sum.active--
			}
		}
		delete(t.sessions, oldest)
	}
}

func (s *activitySession) setStep(step string, now time.Time) {
	s.step = step
	s.lastStep = now
	s.stepCount++
}

// ---------------------------------------------------------------- snapshots

type activityStepJSON struct {
	Step string `json:"step"`
	Age  int64  `json:"ageMs"`
}

type activitySessionJSON struct {
	ID           string            `json:"id"`
	Model        string            `json:"model"`
	Provider     string            `json:"provider"`
	Combo        string            `json:"combo,omitempty"`
	Kind         string            `json:"kind,omitempty"`
	Stream       bool              `json:"stream"`
	Status       string            `json:"status"` // running | waiting | ok | error
	ElapsedMs    int64             `json:"elapsedMs"`
	Step         string            `json:"step"`
	Steps        int               `json:"steps"`
	Targets      int               `json:"targets"`
	Attempt      int               `json:"attempt"`
	Inflight     int               `json:"inflight"`
	TTFBMs       int64             `json:"ttfbMs"`
	OutTokens    int               `json:"outTokens"`
	PromptTokens int               `json:"promptTokens"`
	Completion   int               `json:"completionTokens"`
	TPS          float64           `json:"tps"`
	Finished     bool              `json:"finished"`
	ResponseCode int               `json:"responseCode,omitempty"`
	Error        string            `json:"error,omitempty"`
	Recent       []activityStepJSON `json:"recent,omitempty"`
}

func sessionStatus(s *activitySession, now time.Time) string {
	switch {
	case s.done && s.ok:
		return "ok"
	case s.done:
		return "error"
	case s.inflight > 0 && now.Sub(s.lastOutput) < activityStallGrace:
		return "running"
	case s.inflight > 0:
		return "waiting"
	case now.Sub(s.lastStep) < activityStallGrace:
		return "running"
	default:
		return "waiting"
	}
}

// Snapshot renders the live state for /api/live. `since` lets a polling UI
// request only the deltas (sessions started or changed after it), so the
// endpoint is cheap even at a 1s cadence.
func (t *ActivityTracker) Snapshot(since time.Time) (map[string]any, []activitySessionJSON) {
	now := nowUTC()
	t.mu.Lock()
	defer t.mu.Unlock()
	t.reapLocked(now)

	waiting, streams, inflight := 0, 0, 0
	for _, s := range t.sessions {
		if s.done {
			continue
		}
		if sessionStatus(s, now) == "waiting" {
			waiting++
		}
		if s.inflight > 0 {
			inflight += s.inflight
			if s.stream {
				streams++
			}
		}
	}

	sessions := make([]activitySessionJSON, 0, len(t.sessions))
	var maxAge float64
	for _, s := range t.sessions {
		if !since.IsZero() && s.done && !s.lastStep.After(since) && !s.started.After(since) {
			continue
		}
		j := activitySessionJSON{
			ID:           s.id,
			Model:        s.model,
			Provider:     s.provider,
			Combo:        s.combo,
			Kind:         s.kind,
			Stream:       s.stream,
			Status:       sessionStatus(s, now),
			Step:         s.step,
			Steps:        s.stepCount,
			Targets:      s.targets,
			Attempt:      s.attempt,
			Inflight:     s.inflight,
			TTFBMs:       s.ttfbMs,
			OutTokens:    s.outTokens,
			PromptTokens: s.promptTokens,
			Completion:   s.completion,
			TPS:          s.tps,
			Finished:     s.done,
			ResponseCode: s.responseCode,
			Error:        s.errText,
		}
		end := now
		if s.done && !s.endedAt.IsZero() {
			end = s.endedAt
		}
		el := end.Sub(s.started)
		j.ElapsedMs = el.Milliseconds()
		if !s.done && el.Seconds() > maxAge {
			maxAge = el.Seconds()
		}
		sessions = append(sessions, j)
	}

	return map[string]any{
		"generatedAt":  now.UTC().Format(time.RFC3339Nano),
		"rps":          round2(t.sum.rps),
		"tps":          round2(t.sum.tps),
		"active":       t.sum.active,
		"waiting":      waiting,
		"streams":      streams,
		"inflight":     inflight,
		"errors":       t.sum.errors,
		"retries":      t.sum.retries,
		"oldestAgeSec": round1(maxAge),
	}, sessions
}

// ObserveRate feeds the rolling RPS/TPS figures the animation draws. Called
// from the Observability middleware so the numbers come from the same place
// the usage rows do.
func ObserveRate(rps, tps float64, retryDelta int) {
	liveActivity.mu.Lock()
	defer liveActivity.mu.Unlock()
	liveActivity.sum.rps = rps
	if tps > 0 {
		liveActivity.sum.tps = tps
	}
	if retryDelta > 0 {
		liveActivity.sum.retries += retryDelta
	}
}

// ResetLiveActivity clears all state. Test-only.
func ResetLiveActivity() {
	liveActivity.mu.Lock()
	defer liveActivity.mu.Unlock()
	liveActivity.sessions = make(map[string]*activitySession)
	liveActivity.sum = activitySum{}
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

// handleLiveActivity serves GET /api/live — the Overview animation feed.
//
// It is admin-session gated like the rest of /api/ (mounted through
// RegisterAdminRoutes), and intentionally cheap: one mutex, no DB access,
// no per-request allocation beyond the JSON body. `?since=RFC3339` returns
// only sessions touched after that instant.
func handleLiveActivity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var since time.Time
	if raw := r.URL.Query().Get("since"); raw != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, raw); err == nil {
			since = parsed
		}
	}

	summary, sessions := liveActivity.Snapshot(since)
	summary["sessions"] = sessions
	summary["count"] = len(sessions)
	_ = json.NewEncoder(w).Encode(summary)
}
