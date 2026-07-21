package middleware

import (
	"encoding/json"
	"time"

	"myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
)

type TracePreview struct {
	System string `json:"system,omitempty"`
	User   string `json:"user,omitempty"`
}

func Observability(ctx *context.GatewayContext, next HandlerFunc) error {
	// Execute downstream pipeline first to capture outcomes and metrics
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

	// Check trace storage settings (default is summary / preview mode)
	settings, _ := db.GetSettings()
	if settings != nil && settings.TraceStorageMode == "disabled" {
		return err
	}

	// Zero-allocation preview extraction (512 chars max for system/user prompts)
	preview := extractMessagePreview(ctx.RequestBody, 512)

	// 2. Record lean telemetry JSON to requestDetails
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
		"preview":          preview,
	}

	// Opt-in debug mode: include truncated message arrays only if traceStorageMode is explicitly "full"
	if settings != nil && settings.TraceStorageMode == "full" {
		if msgs, ok := ctx.RequestBody["messages"].([]interface{}); ok {
			traceData["optimizedMessages"] = truncateMessagesForTrace(msgs)
		}
	}

	traceJSON, _ := json.Marshal(traceData)
	_ = db.SaveRequestTrace(ctx.RequestID, ctx.Provider, ctx.Model, connID, statusStr, string(traceJSON))

	return err
}

func extractMessagePreview(body map[string]interface{}, maxLen int) TracePreview {
	var preview TracePreview
	if body == nil {
		return preview
	}
	msgs, ok := body["messages"].([]interface{})
	if !ok || len(msgs) == 0 {
		return preview
	}

	for _, m := range msgs {
		msgMap, ok := m.(map[string]interface{})
		if !ok {
			continue
		}
		role, _ := msgMap["role"].(string)
		content, _ := msgMap["content"].(string)
		if content == "" {
			continue
		}

		if (role == "system" || role == "developer") && preview.System == "" {
			if len(content) > maxLen {
				preview.System = content[:maxLen] + "...[TRUNCATED]"
			} else {
				preview.System = content
			}
		} else if role == "user" && preview.User == "" {
			if len(content) > maxLen {
				preview.User = content[:maxLen] + "...[TRUNCATED]"
			} else {
				preview.User = content
			}
		}

		if preview.System != "" && preview.User != "" {
			break
		}
	}

	return preview
}

func truncateMessagesForTrace(msgs []interface{}) []interface{} {
	if len(msgs) == 0 {
		return nil
	}
	result := make([]interface{}, 0, len(msgs))
	for _, m := range msgs {
		msgMap, ok := m.(map[string]interface{})
		if !ok {
			result = append(result, m)
			continue
		}
		cloned := make(map[string]interface{}, len(msgMap))
		for k, v := range msgMap {
			if k == "content" {
				if str, ok := v.(string); ok {
					if len(str) > 500 {
						cloned[k] = str[:500] + "...[TRUNCATED]"
					} else {
						cloned[k] = str
					}
				} else {
					cloned[k] = v
				}
			} else {
				cloned[k] = v
			}
		}
		result = append(result, cloned)
	}
	return result
}
