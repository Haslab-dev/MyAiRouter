package middleware

import (
	"encoding/json"
	"time"

	"myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
)

func Observability(ctx *context.GatewayContext, next HandlerFunc) error {
	// Execute the downstream pipeline first to capture outcomes and metrics
	err := next(ctx)

	// Complete duration metrics
	ctx.Latency = time.Since(ctx.StartTime)
	ctx.AddStep("Observability Engine", "success", "Recording pipeline details")

	statusStr := "ok"
	if ctx.ResponseCode >= 400 || err != nil {
		statusStr = "error"
	}

	// Calculate upstream API cost
	ctx.Cost = db.CalculateCost(ctx.Provider, ctx.Model, ctx.PromptTokens, ctx.CompletionTokens, ctx.CachedTokens)

	// Extract pipeline steps
	type stepLog struct {
		Name       string `json:"name"`
		DurationMs int64  `json:"durationMs"`
		Status     string `json:"status"`
		Details    string `json:"details"`
	}
	steps := make([]stepLog, 0, len(ctx.Steps))
	for _, s := range ctx.Steps {
		steps = append(steps, stepLog{
			Name:       s.Name,
			DurationMs: s.DurationMs,
			Status:     s.Status,
			Details:    s.Details,
		})
	}

	// Aggregate metrics for standard usage tracking
	metaMap := map[string]interface{}{
		"duration_ms": ctx.Latency.Milliseconds(),
		"ttfb_ms":     ctx.TTFB.Milliseconds(),
		"retry_count": ctx.RetryCount,
		"fallback":    ctx.FallbackCount,
		"cache_hit":   ctx.Metadata["cacheHit"] == true,
	}
	metaJSON, _ := json.Marshal(metaMap)

	connID := ""
	if ctx.Connection != nil {
		connID = ctx.Connection.ID
	}

	// 1. Record in standard usage table (for charts and KPI sums)
	_ = db.SaveRequestUsage(&db.UsageEntry{
		Provider:         ctx.Provider,
		Model:            ctx.Model,
		ConnectionID:     connID,
		APIKey:           ctx.UserID,
		Endpoint:         "/v1/chat/completions",
		PromptTokens:     ctx.PromptTokens,
		CompletionTokens: ctx.CompletionTokens,
		CachedTokens:     ctx.CachedTokens,
		Status:           statusStr,
		Tokens: db.TokenUsage{
			PromptTokens:     ctx.PromptTokens,
			CompletionTokens: ctx.CompletionTokens,
			CachedTokens:     ctx.CachedTokens,
		},
		Meta:             string(metaJSON),
	})

	// 2. Record detailed telemetry JSON to requestDetails
	traceData := map[string]interface{}{
		"requestId":        ctx.RequestID,
		"timestamp":        time.Now().UTC().Format(time.RFC3339),
		"provider":         ctx.Provider,
		"model":            ctx.Model,
		"originalModel":    ctx.OriginalModel,
		"connectionId":     connID,
		"status":           statusStr,
		"latencyMs":        ctx.Latency.Milliseconds(),
		"ttfbMs":           ctx.TTFB.Milliseconds(),
		"cost":             ctx.Cost,
		"promptTokens":     ctx.PromptTokens,
		"completionTokens": ctx.CompletionTokens,
		"cachedTokens":     ctx.CachedTokens,
		"steps":            steps,
		"errors":           ctx.Errors,
	}
	traceJSON, _ := json.Marshal(traceData)
	_ = db.SaveRequestTrace(ctx.RequestID, ctx.Provider, ctx.Model, connID, statusStr, string(traceJSON))

	return err
}
