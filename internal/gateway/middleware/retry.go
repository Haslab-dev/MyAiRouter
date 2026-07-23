package middleware

import (
	"encoding/json"
	"fmt"
	"net/http"

	"myAiRouter/internal/gateway/context"
)

func Retry(ctx *context.GatewayContext, next HandlerFunc) error {
	targets, ok := ctx.Metadata["routingTargets"].([]ConnectionModel)
	if !ok || len(targets) == 0 {
		ctx.WriteError(http.StatusServiceUnavailable, "Routing targets not resolved")
		ctx.AddStep("Retry/Fallback Engine", "failed", "No targets available")
		return nil
	}

	// Backup original request body to prevent cumulative mutation side-effects during fallbacks
	originalBody := cloneMap(ctx.RequestBody)

	var lastErr error
	var lastStatus int = http.StatusServiceUnavailable

	for i, target := range targets {
		ctx.Connection = &target.Connection
		ctx.Model = target.ModelName
		ctx.Provider = target.Provider

		// Refresh body with clean clone for this attempt
		ctx.RequestBody = cloneMap(originalBody)
		ctx.RequestBody["model"] = target.ModelName

		// Execute downstream middlewares for this node (PromptRewrite, Compression, Cache, Provider, etc.)
		err := next(ctx)
		if err == nil && ctx.ResponseCode < 400 {
			ctx.AddStep("Retry/Fallback Engine", "success", fmt.Sprintf("Attempt %d succeeded (status %d)", i+1, ctx.ResponseCode))
			return nil
		}

		ctx.RetryCount++
		if i < len(targets)-1 {
			ctx.FallbackCount++
		}

		if err != nil {
			lastErr = err
			ctx.Errors = append(ctx.Errors, err.Error())
		} else {
			lastErr = fmt.Errorf("upstream responded with HTTP %d", ctx.ResponseCode)
			ctx.Errors = append(ctx.Errors, lastErr.Error())
		}
		lastStatus = ctx.ResponseCode

		// Do not retry on client-side errors (400 Bad Request)
		if ctx.ResponseCode == http.StatusBadRequest {
			ctx.AddStep("Retry/Fallback Engine", "failed", "Bypassed fallback loop due to 400 Bad Request")
			return nil
		}
	}

	errMsg := "All fallback routes and provider accounts exhausted"
	if lastErr != nil {
		errMsg = fmt.Sprintf("%s: %v", errMsg, lastErr)
	}
	ctx.WriteError(lastStatus, errMsg)
	ctx.AddStep("Retry/Fallback Engine", "failed", "All fallback attempts failed")
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
