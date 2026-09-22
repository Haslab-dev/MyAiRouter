package health

import (
	"sort"
	"sync"
	"time"
)

const (
	baseCooldown     = 30 * time.Second
	maxCooldown      = 5 * time.Minute
	latencyEWMAAlpha = 0.3 // weight of the newest latency sample
)

// connState is the in-memory health state of one provider connection.
// State is deliberately not persisted: it describes only recent behavior.
type connState struct {
	consecutiveFailures int
	cooldownUntil       time.Time
	ewmaLatencyMs       float64
	ewmaTTFBMs          float64
	samples             int
	lastFailureAt       time.Time
}

// Tracker keeps per-connection health used by the routing engine to skip
// recently-failed upstreams and order accounts by observed responsiveness.
type Tracker struct {
	mu     sync.RWMutex
	states map[string]*connState
}

var defaultTracker = &Tracker{states: make(map[string]*connState)}

// Get returns the process-wide tracker.
func Get() *Tracker { return defaultTracker }

// RecordSuccess clears the failure streak and folds the observed latency and
// TTFB into the EWMA estimates.
func (t *Tracker) RecordSuccess(connectionID string, latencyMs, ttfbMs int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	s := t.states[connectionID]
	if s == nil {
		s = &connState{}
		t.states[connectionID] = s
	}
	s.consecutiveFailures = 0
	s.cooldownUntil = time.Time{}
	if latencyMs > 0 {
		s.ewmaLatencyMs = ewma(s.ewmaLatencyMs, float64(latencyMs))
	}
	if ttfbMs > 0 {
		s.ewmaTTFBMs = ewma(s.ewmaTTFBMs, float64(ttfbMs))
	}
	s.samples++
}

// RecordFailure increments the failure streak and puts the connection into an
// exponentially growing cooldown (30s, 60s, ... capped at 5m).
func (t *Tracker) RecordFailure(connectionID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	s := t.states[connectionID]
	if s == nil {
		s = &connState{}
		t.states[connectionID] = s
	}
	s.consecutiveFailures++
	s.lastFailureAt = time.Now()

	backoff := baseCooldown
	for i := 1; i < s.consecutiveFailures; i++ {
		backoff *= 2
		if backoff >= maxCooldown {
			backoff = maxCooldown
			break
		}
	}
	s.cooldownUntil = time.Now().Add(backoff)
}

// InCooldown reports whether the connection is currently serving a cooldown.
func (t *Tracker) InCooldown(connectionID string) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	s := t.states[connectionID]
	return s != nil && time.Now().Before(s.cooldownUntil)
}

// LatencyMs returns the EWMA latency estimate, or -1 when no sample exists.
func (t *Tracker) LatencyMs(connectionID string) float64 {
	t.mu.RLock()
	defer t.mu.RUnlock()
	s := t.states[connectionID]
	if s == nil || s.samples == 0 {
		return -1
	}
	return s.ewmaLatencyMs
}

// Status is the JSON shape exposed to the admin UI.
type Status struct {
	ConnectionID        string  `json:"connectionId"`
	Healthy             bool    `json:"healthy"`
	ConsecutiveFailures int     `json:"consecutiveFailures"`
	CooldownSecondsLeft int     `json:"cooldownSecondsLeft"`
	EwmaLatencyMs       float64 `json:"ewmaLatencyMs"`
	EwmaTTFBMs          float64 `json:"ewmaTtfbMs"`
	Samples             int     `json:"samples"`
}

// Snapshot returns the current state of every tracked connection, worst first.
func (t *Tracker) Snapshot() []Status {
	t.mu.RLock()
	defer t.mu.RUnlock()
	now := time.Now()

	out := make([]Status, 0, len(t.states))
	for id, s := range t.states {
		st := Status{
			ConnectionID:        id,
			Healthy:             now.After(s.cooldownUntil) || s.cooldownUntil.IsZero(),
			ConsecutiveFailures: s.consecutiveFailures,
			EwmaLatencyMs:       round1(s.ewmaLatencyMs),
			EwmaTTFBMs:          round1(s.ewmaTTFBMs),
			Samples:             s.samples,
		}
		if !st.Healthy {
			st.CooldownSecondsLeft = int(time.Until(s.cooldownUntil).Seconds())
		}
		out = append(out, st)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Healthy != out[j].Healthy {
			return out[i].Healthy // healthy first
		}
		return out[i].EwmaLatencyMs < out[j].EwmaLatencyMs
	})
	return out
}

func ewma(prev, next float64) float64 {
	if prev == 0 {
		return next
	}
	return prev*(1-latencyEWMAAlpha) + next*latencyEWMAAlpha
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}
