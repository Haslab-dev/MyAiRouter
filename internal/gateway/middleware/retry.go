package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	gwContext "myAiRouter/internal/gateway/context"
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
		if err != nil || ctx.ResponseCode >= 400 {
			status = "failed"
			if err != nil {
				errStr = err.Error()
			} else {
				errStr = fmt.Sprintf("HTTP %d", ctx.ResponseCode)
			}
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

		return err
	}

	comboKind, _ := ctx.Metadata["comboKind"].(string)

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

	// Sequential combo strategies: fallback, smart, load_balance, progressive
	originalBody := cloneMap(ctx.RequestBody)
	var lastErr error
	var lastStatus int = http.StatusServiceUnavailable

	for i, target := range targets {
		attemptStart := time.Now()
		ctx.Connection = &target.Connection
		ctx.Model = target.ModelName
		ctx.Provider = target.Provider

		ctx.RequestBody = cloneMap(originalBody)
		ctx.RequestBody["model"] = target.ModelName

		// Fast per-node attempt timeout (3.5s) if remaining targets exist, ensuring instant switch on slow/hanging nodes
		var attemptCtx context.Context
		var cancelAttempt context.CancelFunc
		if i < len(targets)-1 {
			attemptCtx, cancelAttempt = context.WithTimeout(ctx.Context, 3500*time.Millisecond)
		} else {
			attemptCtx, cancelAttempt = context.WithTimeout(ctx.Context, 60*time.Second)
		}

		oldCtx := ctx.Context
		ctx.Context = attemptCtx

		err := next(ctx)
		durMs := time.Since(attemptStart).Milliseconds()
		cancelAttempt()
		ctx.Context = oldCtx

		if err == nil && ctx.ResponseCode < 400 {
			if comboKind == "progressive" && i < len(targets)-1 {
				if isLowConfidence(ctx.ResponseBody) {
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
			}

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

		ctx.RetryCount++
		if i < len(targets)-1 {
			ctx.FallbackCount++
		}

		errStr := ""
		if err != nil {
			errStr = err.Error()
			lastErr = err
			ctx.Errors = append(ctx.Errors, errStr)
		} else {
			errStr = fmt.Sprintf("Upstream HTTP %d", ctx.ResponseCode)
			lastErr = fmt.Errorf("%s", errStr)
			ctx.Errors = append(ctx.Errors, errStr)
		}
		lastStatus = ctx.ResponseCode

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
	}

	errMsg := "All provider accounts and routes exhausted"
	if lastErr != nil {
		errMsg = fmt.Sprintf("%s: %v", errMsg, lastErr)
	}
	ctx.WriteError(lastStatus, errMsg)
	ctx.AddStep("Routing Engine", "failed", "All attempts failed")
	return nil
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

type targetResult struct {
	target           ConnectionModel
	responseCode     int
	responseBody     []byte
	isStream         bool
	promptTokens     int
	completionTokens int
	cachedTokens     int
	ttfb             time.Duration
	steps            []gwContext.TraceStep
	err              error
}

func executeRaceStrategy(ctx *gwContext.GatewayContext, targets []ConnectionModel, next HandlerFunc) error {
	ctx.AddStep("Race (Hedged)", "info", fmt.Sprintf("Launching hedged race across %d models with 400ms delay", len(targets)))
	originalBody := cloneMap(ctx.RequestBody)
	resultChan := make(chan targetResult, len(targets))
	doneCtx, cancel := context.WithCancel(ctx.Context)
	defer cancel()

	var wg sync.WaitGroup

	runTarget := func(t ConnectionModel) {
		defer wg.Done()
		subCtx := ctx.CloneForTarget(doneCtx, &t.Connection, t.ModelName, t.Provider, cloneMap(originalBody))
		err := next(subCtx)
		if subCtx.ResponseCode < 400 && err == nil {
			select {
			case resultChan <- targetResult{
				target:           t,
				responseCode:     subCtx.ResponseCode,
				responseBody:     subCtx.ResponseBody,
				isStream:         subCtx.IsStream,
				promptTokens:     subCtx.PromptTokens,
				completionTokens: subCtx.CompletionTokens,
				cachedTokens:     subCtx.CachedTokens,
				ttfb:             subCtx.TTFB,
				steps:            subCtx.Steps,
			}:
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
		ctx.AddStep("Race (Hedged)", "success", msg)
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

	for _, t := range targets {
		target := t
		go func() {
			subCtx := ctx.CloneForTarget(doneCtx, &target.Connection, target.ModelName, target.Provider, cloneMap(originalBody))
			err := next(subCtx)
			if subCtx.ResponseCode < 400 && err == nil {
				select {
				case resultChan <- targetResult{
					target:           target,
					responseCode:     subCtx.ResponseCode,
					responseBody:     subCtx.ResponseBody,
					promptTokens:     subCtx.PromptTokens,
					completionTokens: subCtx.CompletionTokens,
					cachedTokens:     subCtx.CachedTokens,
					ttfb:             subCtx.TTFB,
					steps:            subCtx.Steps,
				}:
					cancel()
				default:
				}
			}
		}()
	}

	select {
	case res := <-resultChan:
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
		ctx.AddStep("Parallel Execution", "success", fmt.Sprintf("Fastest model %s returned response", res.target.ModelName))
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
			subCtx := ctx.CloneForTarget(ctx.Context, &target.Connection, target.ModelName, target.Provider, cloneMap(originalBody))
			err := next(subCtx)
			if subCtx.ResponseCode < 400 && err == nil && len(subCtx.ResponseBody) > 0 {
				mu.Lock()
				results = append(results, targetResult{
					target:           target,
					responseCode:     subCtx.ResponseCode,
					responseBody:     subCtx.ResponseBody,
					promptTokens:     subCtx.PromptTokens,
					completionTokens: subCtx.CompletionTokens,
					cachedTokens:     subCtx.CachedTokens,
					ttfb:             subCtx.TTFB,
					steps:            subCtx.Steps,
				})
				mu.Unlock()
			}
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

	ctx.Connection = &bestRes.target.Connection
	ctx.Model = bestRes.target.ModelName
	ctx.Provider = bestRes.target.Provider
	ctx.ResponseCode = bestRes.responseCode
	ctx.ResponseBody = bestRes.responseBody
	ctx.PromptTokens = bestRes.promptTokens
	ctx.CompletionTokens = bestRes.completionTokens
	ctx.CachedTokens = bestRes.cachedTokens
	ctx.TTFB = bestRes.ttfb
	ctx.Steps = append(ctx.Steps, bestRes.steps...)
	ctx.AddStep("Ensemble Synthesis", "success", fmt.Sprintf("Selected top ensemble response from %s (%d models consensus)", bestRes.target.ModelName, len(results)))
	return nil
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
