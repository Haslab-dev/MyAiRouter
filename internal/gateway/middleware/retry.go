package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	gwContext "myAiRouter/internal/gateway/context"
	"myAiRouter/internal/gateway/health"
	"myAiRouter/pkg/db"
)

func Retry(ctx *gwContext.GatewayContext, next HandlerFunc) error {
	targets, ok := ctx.Metadata["routingTargets"].([]ConnectionModel)
	if !ok || len(targets) == 0 {
		ctx.WriteError(http.StatusServiceUnavailable, "Routing targets not resolved")
		ctx.AddStep("Routing Engine", "failed", "No targets available")
		return nil
	}

	// Single model call (non-combo): Direct 1:1 pass-through with zero latency overhead
	if len(targets) == 1 {
		target := targets[0]
		ctx.Connection = &target.Connection
		ctx.Model = target.ModelName
		ctx.Provider = target.Provider
		ctx.RequestBody["model"] = target.ModelName

		attemptStart := time.Now()
		err := next(ctx)
		durMs := time.Since(attemptStart).Milliseconds()

		status := "success"
		errStr := ""
		failed := err != nil || ctx.ResponseCode >= 400
		if failed {
			status = "failed"
			health.Get().RecordFailure(target.Connection.ID)
			if err != nil {
				errStr = err.Error()
			} else {
				errStr = fmt.Sprintf("HTTP %d", ctx.ResponseCode)
			}
		} else {
			health.Get().RecordSuccess(target.Connection.ID, durMs, ctx.TTFB.Milliseconds())
		}

		ctx.TargetAttempts = append(ctx.TargetAttempts, gwContext.TargetAttempt{
			Index:        1,
			Provider:     target.Provider,
			Model:        target.ModelName,
			ConnectionID: target.Connection.ID,
			Status:       status,
			ResponseCode: ctx.ResponseCode,
			DurationMs:   durMs,
			Error:        errStr,
		})

		// Single target: there is nowhere to fall back, so the upstream
		// failure must reach the client instead of an empty 200.
		if failed {
			writeUpstreamError(ctx, ctx.ResponseCode)
			return nil
		}
		return err
	}

	comboKind, _ := ctx.Metadata["comboKind"].(string)

	// Concurrent strategies materialize several upstream responses at once and
	// cannot share the client socket once a stream starts, so streaming
	// requests always take the sequential path.
	concurrentRequested := false
	if !ctx.IsStream {
		switch comboKind {
		case "race":
			if len(targets) > 1 {
				return executeRaceStrategy(ctx, targets, next)
			}
		case "parallel":
			if len(targets) > 1 {
				return executeParallelStrategy(ctx, targets, next)
			}
		case "ensemble":
			if len(targets) > 1 {
				return executeEnsembleStrategy(ctx, targets, next)
			}
		}
	} else if comboKind == "race" || comboKind == "parallel" || comboKind == "ensemble" {
		concurrentRequested = true
	}

	// Sequential combo strategies: fallback, smart, load_balance, progressive
	policy := resolveAttemptPolicy(ctx)
	originalBody := cloneMap(ctx.RequestBody)
	var lastErr error
	var lastStatus int = http.StatusServiceUnavailable

	if concurrentRequested {
		ctx.AddStep("Routing Engine", "info", fmt.Sprintf("Combo '%s' requests concurrent execution, which requires stream:false — running sequentially", comboKind))
	}

	for i, target := range targets {
		attemptStart := time.Now()
		ctx.Connection = &target.Connection
		ctx.Model = target.ModelName
		ctx.Provider = target.Provider

		ctx.RequestBody = cloneMap(originalBody)
		ctx.RequestBody["model"] = target.ModelName

		// Fast per-node attempt timeout while more targets remain so slow or
		// hanging nodes are abandoned quickly; the last target is allowed to
		// run to completion. Both are tunable per combo via AttemptPolicy.
		var attemptCtx context.Context
		var cancelAttempt context.CancelFunc
		if i < len(targets)-1 {
			attemptCtx, cancelAttempt = context.WithTimeout(ctx.Context, policy.AttemptTimeout())
		} else {
			attemptCtx, cancelAttempt = context.WithTimeout(ctx.Context, policy.FinalTimeout())
		}

		oldCtx := ctx.Context
		ctx.Context = attemptCtx

		err := next(ctx)
		durMs := time.Since(attemptStart).Milliseconds()
		cancelAttempt()
		ctx.Context = oldCtx

		if err == nil && ctx.ResponseCode < 400 {
			if comboKind == "progressive" && i < len(targets)-1 && isLowConfidence(ctx.ResponseBody) {
				health.Get().RecordFailure(target.Connection.ID)
				ctx.TargetAttempts = append(ctx.TargetAttempts, gwContext.TargetAttempt{
					Index:        i + 1,
					Provider:     target.Provider,
					Model:        target.ModelName,
					ConnectionID: target.Connection.ID,
					Status:       "failed",
					ResponseCode: ctx.ResponseCode,
					DurationMs:   durMs,
					Error:        "Low confidence output",
				})
				ctx.AddStep("Progressive Routing", "info", fmt.Sprintf("Low confidence output on %s, escalating to %s", target.ModelName, targets[i+1].ModelName))
				ctx.FallbackCount++
				continue
			}

			health.Get().RecordSuccess(target.Connection.ID, durMs, ctx.TTFB.Milliseconds())
			ctx.TargetAttempts = append(ctx.TargetAttempts, gwContext.TargetAttempt{
				Index:        i + 1,
				Provider:     target.Provider,
				Model:        target.ModelName,
				ConnectionID: target.Connection.ID,
				Status:       "success",
				ResponseCode: ctx.ResponseCode,
				DurationMs:   durMs,
			})

			for j := i + 1; j < len(targets); j++ {
				ctx.TargetAttempts = append(ctx.TargetAttempts, gwContext.TargetAttempt{
					Index:        j + 1,
					Provider:     targets[j].Provider,
					Model:        targets[j].ModelName,
					ConnectionID: targets[j].Connection.ID,
					Status:       "skipped",
				})
			}

			ctx.AddStep("Routing Engine", "success", fmt.Sprintf("Attempt %d succeeded with %s (status %d)", i+1, target.ModelName, ctx.ResponseCode))
			return nil
		}

		// Attempt failed: classify the failure before deciding how to proceed.
		health.Get().RecordFailure(target.Connection.ID)
		class := ErrRetryable
		if err == nil {
			class = ClassifyStatusWithPolicy(ctx.ResponseCode, policy.FallbackPolicy)
		}

		errStr := ""
		if err != nil {
			errStr = err.Error()
			lastErr = err
		} else {
			errStr = fmt.Sprintf("Upstream HTTP %d", ctx.ResponseCode)
			lastErr = fmt.Errorf("%s", errStr)
		}
		lastStatus = ctx.ResponseCode
		ctx.RetryCount++
		ctx.Errors = append(ctx.Errors, errStr)

		ctx.TargetAttempts = append(ctx.TargetAttempts, gwContext.TargetAttempt{
			Index:        i + 1,
			Provider:     target.Provider,
			Model:        target.ModelName,
			ConnectionID: target.Connection.ID,
			Status:       "failed",
			ResponseCode: ctx.ResponseCode,
			DurationMs:   durMs,
			Error:        errStr,
		})

		// Terminal: the request itself is rejected (400, 404, 413, 422, ...);
		// retrying it elsewhere would burn tokens for the same outcome. The
		// upstream error is passed through unchanged.
		if class == ErrTerminal {
			ctx.AddStep("Routing Engine", "failed", fmt.Sprintf("Terminal error HTTP %d on %s — not falling back", ctx.ResponseCode, target.ModelName))
			writeUpstreamError(ctx, ctx.ResponseCode)
			return nil
		}

		// Auth failure (401/403): the account is the problem. Remaining
		// accounts of the same provider may be tried, but the engine never
		// silently hands the client to a different provider's model.
		if class == ErrAccountFailover && (i+1 >= len(targets) || targets[i+1].Provider != target.Provider) {
			ctx.AddStep("Routing Engine", "failed", fmt.Sprintf("Auth error HTTP %d on %s — no further %s accounts to try", ctx.ResponseCode, target.ModelName, target.Provider))
			writeUpstreamError(ctx, ctx.ResponseCode)
			return nil
		}

		// Retry budget: stop after the configured number of fallback hops.
		if max := policy.MaxFallbackCount(); max > 0 && ctx.FallbackCount >= max {
			ctx.AddStep("Routing Engine", "failed", fmt.Sprintf("Fallback budget exhausted (%d hops)", max))
			ctx.WriteError(lastStatus, fmt.Sprintf("Fallback budget exhausted: %v", lastErr))
			return nil
		}

		if i < len(targets)-1 {
			ctx.FallbackCount++
		}
	}

	errMsg := "All provider accounts and routes exhausted"
	if lastErr != nil {
		errMsg = fmt.Sprintf("%s: %v", errMsg, lastErr)
	}
	ctx.WriteError(lastStatus, errMsg)
	ctx.AddStep("Routing Engine", "failed", "All attempts failed")
	return nil
}

func resolveAttemptPolicy(ctx *gwContext.GatewayContext) *db.AttemptPolicy {
	if p, ok := ctx.Metadata["attemptPolicy"].(*db.AttemptPolicy); ok && p != nil {
		return p
	}
	// Zero-value policy resolves to the engine defaults (auto classification,
	// 3.5s attempt timeout, 60s final timeout, unlimited fallbacks).
	return &db.AttemptPolicy{}
}

// writeUpstreamError forwards the stored upstream error response to the
// client as-is, preserving the provider's own error message.
func writeUpstreamError(ctx *gwContext.GatewayContext, status int) {
	if status < 400 {
		status = http.StatusBadGateway
	}
	ctx.ResponseCode = status
	if len(ctx.ResponseBody) > 0 {
		ctx.ResponseWriter.Header().Set("Content-Type", "application/json")
		ctx.ResponseWriter.WriteHeader(status)
		_, _ = ctx.ResponseWriter.Write(ctx.ResponseBody)
		return
	}
	ctx.WriteError(status, "Upstream request failed")
}

func isLowConfidence(body []byte) bool {
	if len(body) == 0 {
		return true
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(body, &resp); err != nil {
		return false
	}
	if choices, ok := resp["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if finishReason, ok := choice["finish_reason"].(string); ok && finishReason == "length" {
				return true
			}
			if msg, ok := choice["message"].(map[string]interface{}); ok {
				if content, ok := msg["content"].(string); ok {
					trimmed := strings.TrimSpace(content)
					if len(trimmed) < 10 || strings.Contains(strings.ToLower(trimmed), "i cannot fulfill") {
						return true
					}
				}
			}
		}
	}
	return false
}

// responseRecorder captures what a child attempt writes so concurrent
// strategies can replay exactly one winning response to the client socket.
type responseRecorder struct {
	header http.Header
	buf    bytes.Buffer
	code   int
	wrote  bool
}

func newResponseRecorder() *responseRecorder {
	return &responseRecorder{header: make(http.Header)}
}

func (r *responseRecorder) Header() http.Header { return r.header }

func (r *responseRecorder) Write(p []byte) (int, error) {
	if !r.wrote {
		r.code = http.StatusOK
		r.wrote = true
	}
	return r.buf.Write(p)
}

func (r *responseRecorder) WriteHeader(code int) {
	if !r.wrote {
		r.code = code
		r.wrote = true
	}
}

func (r *responseRecorder) Flush() {}

// replayResponse writes a captured child response to the real client writer.
func replayResponse(w http.ResponseWriter, rec *responseRecorder) {
	for k, vv := range rec.header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	if !rec.wrote {
		rec.code = http.StatusOK
	}
	w.WriteHeader(rec.code)
	_, _ = w.Write(rec.buf.Bytes())
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

type targetResult struct {
	target           ConnectionModel
	responseCode     int
	responseBody     []byte
	rec              *responseRecorder
	metadata         map[string]any
	attempts         []gwContext.TargetAttempt
	promptTokens     int
	completionTokens int
	cachedTokens     int
	ttfb             time.Duration
	steps            []gwContext.TraceStep
}

// runChildWithRecorder executes one attempt of a concurrent strategy against a
// buffered writer and returns its captured result. The child never touches the
// real client socket; only a winning result is replayed by the caller.
func runChildWithRecorder(ctx *gwContext.GatewayContext, doneCtx context.Context, target ConnectionModel, body map[string]interface{}, next HandlerFunc) (targetResult, bool) {
	rec := newResponseRecorder()
	subCtx := ctx.CloneForTarget(doneCtx, &target.Connection, target.ModelName, target.Provider, body)
	subCtx.ResponseWriter = rec

	start := time.Now()
	err := next(subCtx)
	durMs := time.Since(start).Milliseconds()

	success := err == nil && subCtx.ResponseCode < 400
	if success {
		health.Get().RecordSuccess(target.Connection.ID, durMs, subCtx.TTFB.Milliseconds())
	} else {
		health.Get().RecordFailure(target.Connection.ID)
	}

	return targetResult{
		target:           target,
		responseCode:     subCtx.ResponseCode,
		responseBody:     subCtx.ResponseBody,
		rec:              rec,
		metadata:         subCtx.Metadata,
		attempts:         subCtx.TargetAttempts,
		promptTokens:     subCtx.PromptTokens,
		completionTokens: subCtx.CompletionTokens,
		cachedTokens:     subCtx.CachedTokens,
		ttfb:             subCtx.TTFB,
		steps:            subCtx.Steps,
	}, success
}

func executeRaceStrategy(ctx *gwContext.GatewayContext, targets []ConnectionModel, next HandlerFunc) error {
	ctx.AddStep("Race (Hedged)", "info", fmt.Sprintf("Launching hedged race across %d models with 400ms delay", len(targets)))
	originalBody := cloneMap(ctx.RequestBody)
	resultChan := make(chan targetResult, len(targets))
	doneCtx, cancel := context.WithCancel(ctx.Context)
	defer cancel()

	var wg sync.WaitGroup
	var attemptsMu sync.Mutex

	runTarget := func(t ConnectionModel) {
		defer wg.Done()
		res, ok := runChildWithRecorder(ctx, doneCtx, t, cloneMap(originalBody), next)
		attemptsMu.Lock()
		ctx.TargetAttempts = append(ctx.TargetAttempts, res.attempts...)
		attemptsMu.Unlock()
		if ok {
			select {
			case resultChan <- res:
				cancel()
			default:
			}
		}
	}

	wg.Add(1)
	go runTarget(targets[0])

	timer := time.NewTimer(400 * time.Millisecond)
	defer timer.Stop()

	applyWin := func(res targetResult, msg string) {
		applyWinner(ctx, res, msg, "Race (Hedged)")
	}

	select {
	case res := <-resultChan:
		applyWin(res, fmt.Sprintf("Primary model %s won race", res.target.ModelName))
		return nil
	case <-timer.C:
		ctx.AddStep("Race (Hedged)", "info", "Primary slow (>400ms), hedging 2nd model")
		for i := 1; i < len(targets); i++ {
			wg.Add(1)
			go runTarget(targets[i])
		}
	}

	select {
	case res := <-resultChan:
		applyWin(res, fmt.Sprintf("Hedged model %s won race", res.target.ModelName))
		return nil
	case <-time.After(30 * time.Second):
		ctx.WriteError(http.StatusGatewayTimeout, "Race hedged requests timed out")
		return nil
	}
}

func executeParallelStrategy(ctx *gwContext.GatewayContext, targets []ConnectionModel, next HandlerFunc) error {
	ctx.AddStep("Parallel Execution", "info", fmt.Sprintf("Dispatching parallel requests to %d models", len(targets)))
	originalBody := cloneMap(ctx.RequestBody)
	resultChan := make(chan targetResult, len(targets))
	doneCtx, cancel := context.WithCancel(ctx.Context)
	defer cancel()

	var attemptsMu sync.Mutex

	for _, t := range targets {
		target := t
		go func() {
			res, ok := runChildWithRecorder(ctx, doneCtx, target, cloneMap(originalBody), next)
			attemptsMu.Lock()
			ctx.TargetAttempts = append(ctx.TargetAttempts, res.attempts...)
			attemptsMu.Unlock()
			if ok {
				select {
				case resultChan <- res:
					cancel()
				default:
				}
			}
		}()
	}

	select {
	case res := <-resultChan:
		applyWinner(ctx, res, fmt.Sprintf("Fastest model %s returned response", res.target.ModelName), "Parallel Execution")
		return nil
	case <-time.After(30 * time.Second):
		ctx.WriteError(http.StatusGatewayTimeout, "Parallel request execution timed out")
		return nil
	}
}

func executeEnsembleStrategy(ctx *gwContext.GatewayContext, targets []ConnectionModel, next HandlerFunc) error {
	ctx.AddStep("Ensemble Synthesis", "info", fmt.Sprintf("Querying %d models for consensus ensemble", len(targets)))
	originalBody := cloneMap(ctx.RequestBody)
	var wg sync.WaitGroup
	var mu sync.Mutex
	var results []targetResult

	for _, t := range targets {
		wg.Add(1)
		target := t
		go func() {
			defer wg.Done()
			res, ok := runChildWithRecorder(ctx, ctx.Context, target, cloneMap(originalBody), next)
			mu.Lock()
			ctx.TargetAttempts = append(ctx.TargetAttempts, res.attempts...)
			if ok && len(res.responseBody) > 0 {
				results = append(results, res)
			}
			mu.Unlock()
		}()
	}

	wg.Wait()

	if len(results) == 0 {
		ctx.WriteError(http.StatusServiceUnavailable, "All ensemble target models failed")
		return nil
	}

	// Select best response (longest / non-truncated)
	bestRes := results[0]
	for _, r := range results {
		if len(r.responseBody) > len(bestRes.responseBody) {
			bestRes = r
		}
	}

	applyWinner(ctx, bestRes, fmt.Sprintf("Selected top ensemble response from %s (%d models consensus)", bestRes.target.ModelName, len(results)), "Ensemble Synthesis")
	return nil
}

// applyWinner promotes a winning child attempt: metrics, traces and the
// captured response are replayed to the real client socket.
func applyWinner(ctx *gwContext.GatewayContext, res targetResult, msg string, stepName string) {
	ctx.Connection = &res.target.Connection
	ctx.Model = res.target.ModelName
	ctx.Provider = res.target.Provider
	ctx.ResponseCode = res.responseCode
	ctx.ResponseBody = res.responseBody
	ctx.PromptTokens = res.promptTokens
	ctx.CompletionTokens = res.completionTokens
	ctx.CachedTokens = res.cachedTokens
	ctx.TTFB = res.ttfb
	ctx.Steps = append(ctx.Steps, res.steps...)
	if res.metadata != nil {
		for _, key := range []string{"prepareResult", "compressionPct"} {
			if v, ok := res.metadata[key]; ok {
				ctx.Metadata[key] = v
			}
		}
	}
	if res.rec != nil {
		replayResponse(ctx.ResponseWriter, res.rec)
	}
	ctx.AddStep(stepName, "success", msg)
}

func cloneMap(src map[string]interface{}) map[string]interface{} {
	b, err := json.Marshal(src)
	if err != nil {
		return src
	}
	var dst map[string]interface{}
	_ = json.Unmarshal(b, &dst)
	return dst
}
