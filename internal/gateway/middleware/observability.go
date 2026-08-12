package middleware

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
)

func Observability(ctx *context.GatewayContext, next HandlerFunc) error {
	// Execute downstream pipeline first to capture outcomes and metrics
	err := next(ctx)

	// Complete duration metrics
	if ctx.StartTime.IsZero() {
		ctx.StartTime = time.Now()
	}
	ctx.Latency = time.Since(ctx.StartTime)
	if ctx.Latency <= 0 {
		ctx.Latency = 1 * time.Millisecond
	}

	latMs := ctx.Latency.Milliseconds()
	if latMs <= 0 && ctx.Latency > 0 {
		latMs = 1
	}

	ttfbMs := ctx.TTFB.Milliseconds()
	if ttfbMs <= 0 && ctx.TTFB > 0 {
		ttfbMs = 1
	}
	if ttfbMs <= 0 {
		ttfbMs = latMs
	}

	ctx.RPS = math.Round(db.GetCurrentRPS()*100) / 100
	latSec := ctx.Latency.Seconds()
	if latSec <= 0 {
		latSec = 0.001
	}

	statusStr := "ok"
	if ctx.ResponseCode >= 400 || err != nil {
		statusStr = "error"
	}

	// --- Token estimation fallback ---
	var promptChars int
	if msgs, ok := ctx.RequestBody["messages"].([]interface{}); ok {
		for _, m := range msgs {
			if msgMap, ok := m.(map[string]interface{}); ok {
				promptChars += len(extractTextFromContent(msgMap["content"]))
			} else if str, ok := m.(string); ok {
				promptChars += len(str)
			}
		}
	} else if prompt, ok := ctx.RequestBody["prompt"].(string); ok {
		promptChars = len(prompt)
	}

	respPreview := extractResponsePreview(ctx.ResponseBody, 512)

	if ctx.PromptTokens == 0 && promptChars > 0 {
		ctx.PromptTokens = int(math.Max(1, float64(promptChars/4)))
	}
	if ctx.CompletionTokens == 0 && len(respPreview) > 0 {
		ctx.CompletionTokens = int(math.Max(1, float64(len(respPreview)/4)))
	}

	ctx.TPS = math.Round((float64(ctx.PromptTokens+ctx.CompletionTokens)/latSec)*10) / 10

	// Calculate upstream API cost
	ctx.Cost = db.CalculateCost(ctx.Provider, ctx.Model, ctx.PromptTokens, ctx.CompletionTokens, ctx.CachedTokens)

	// --- Usage table (for charts / KPI sums) ---
	metaMap := map[string]interface{}{
		"duration_ms": latMs,
		"ttfb_ms":     ttfbMs,
		"retry_count": ctx.RetryCount,
		"fallback":    ctx.FallbackCount,
		"cache_hit":   ctx.Metadata["cacheHit"] == true,
		"rps":         ctx.RPS,
		"tps":         ctx.TPS,
	}
	metaJSON, _ := json.Marshal(metaMap)

	connID := ""
	if ctx.Connection != nil {
		connID = ctx.Connection.ID
	}

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
		Meta: string(metaJSON),
	})

	// --- Trace storage settings check ---
	settings, _ := db.GetSettings()
	if settings != nil && (settings.TraceStorageMode == "disabled" || settings.TraceStorageMode == "off") {
		return err
	}

	// --- Resolve provider / model names ---
	providerName := ctx.Provider
	if providerName == "" {
		if idx := strings.Index(ctx.OriginalModel, "/"); idx != -1 {
			providerName = ctx.OriginalModel[:idx]
		} else {
			providerName = "unknown"
		}
	}
	modelName := ctx.Model
	if modelName == "" {
		if idx := strings.Index(ctx.OriginalModel, "/"); idx != -1 {
			modelName = ctx.OriginalModel[idx+1:]
		} else {
			modelName = ctx.OriginalModel
		}
	}

	// --- Route info ---
	comboKind, _ := ctx.Metadata["comboKind"].(string)
	if comboKind == "" {
		comboKind = "direct"
	}

	// Selected node (the provider/connection that actually responded)
	selectedNode := providerName
	if connID != "" {
		selectedNode = connID
	}

	// All route nodes (the combo's full list)
	var routeNodes []string
	if modelsToTry, ok := ctx.Metadata["modelsToTry"].([]string); ok {
		routeNodes = modelsToTry
	}

	attempt := 1 + ctx.FallbackCount

	// --- Cache status ---
	cacheStatus := "bypass"
	if ctx.Metadata["memoryCacheHit"] == true {
		cacheStatus = "memory_hit"
	} else if ctx.Metadata["cacheHit"] == true {
		cacheStatus = "hit"
	}

	// --- Compression ---
	compressionPct := 0
	if v, ok := ctx.Metadata["compressionPct"].(int); ok {
		compressionPct = v
	}

	// --- Request / Response previews ---
	reqPreview := extractMessagePreview(ctx.RequestBody, 512)
	requestStr := ""
	if reqPreview.System != "" && reqPreview.User != "" {
		requestStr = "[system] " + reqPreview.System + "\n\n[user] " + reqPreview.User
	} else if reqPreview.System != "" {
		requestStr = reqPreview.System
	} else if reqPreview.User != "" {
		requestStr = reqPreview.User
	}



	// --- Construct 6 clean routing-focused pipeline steps ---
	// 1. Resolve Model
	// 2. Prompt Rewrite
	// 3. Optimizer
	// 4. Cache
	// 5. Route
	// 6. Provider
	hasRewrite := false
	for _, s := range ctx.Steps {
		if strings.Contains(s.Name, "Prompt Rewrite") && s.Status == "success" {
			hasRewrite = true
			break
		}
	}

	rewriteStatus := "skipped"
	rewriteDetails := "skipped"
	if hasRewrite {
		rewriteStatus = "success"
		rewriteDetails = "injected system prompt"
	}

	optStatus := "skipped"
	optDetails := "skipped"
	if compressionPct > 0 {
		optStatus = "success"
		optDetails = fmt.Sprintf("saved %d%%", compressionPct)
	}

	cacheStepStatus := "skipped"
	cacheStepDetails := cacheStatus
	if cacheStatus == "hit" {
		cacheStepStatus = "success"
		cacheStepDetails = "hit"
	} else if ctx.IsStream {
		cacheStepDetails = "skipped (stream)"
	}

	pipelineSteps := []db.TracePipelineStep{
		{Name: "Resolve Model", Status: "success", Details: modelName},
		{Name: "Prompt Rewrite", Status: rewriteStatus, Details: rewriteDetails},
		{Name: "Optimizer", Status: optStatus, Details: optDetails},
		{Name: "Cache", Status: cacheStepStatus, Details: cacheStepDetails},
		{Name: "Route", Status: "success", Details: fmt.Sprintf("%s (%s)", providerName, comboKind)},
		{Name: "Provider", Status: statusStr, Details: fmt.Sprintf("%.1f s", float64(latMs)/1000.0), DurationMs: latMs},
	}

	// --- Map target attempts ---
	attempts := make([]db.AttemptDetail, 0, len(ctx.TargetAttempts))
	for _, a := range ctx.TargetAttempts {
		attempts = append(attempts, db.AttemptDetail{
			Index:        a.Index,
			Provider:     a.Provider,
			Model:        a.Model,
			ConnectionID: a.ConnectionID,
			Status:       a.Status,
			ResponseCode: a.ResponseCode,
			DurationMs:   a.DurationMs,
			Error:        a.Error,
		})
	}

	// --- Request / Response metadata ---
	var msgCount int
	if msgs, ok := ctx.RequestBody["messages"].([]interface{}); ok {
		msgCount = len(msgs)
	} else if _, ok := ctx.RequestBody["prompt"].(string); ok {
		msgCount = 1
	}

	finishReason := extractFinishReason(ctx.ResponseBody)

	reqMeta := db.RequestMeta{
		System:   reqPreview.System,
		User:     reqPreview.User,
		Messages: msgCount,
		Chars:    promptChars,
		Tokens:   ctx.PromptTokens,
	}

	if prep, ok := ctx.Metadata["prepareResult"].(PrepareResult); ok {
		reqMeta.Modified = prep.Modified
		reqMeta.CompressionApplied = prep.CompressionApplied
		reqMeta.OriginalTokens = prep.OriginalTokens
		reqMeta.PreparedTokens = prep.PreparedTokens
		reqMeta.CompressedTokens = prep.CompressedTokens
		reqMeta.ProtectedPrefixTokens = prep.ProtectedPrefixTokens
		reqMeta.ProtectedSuffixTokens = prep.ProtectedSuffixTokens
		reqMeta.Strategy = prep.Strategy
	}

	respMeta := db.ResponseMeta{
		Preview:      respPreview,
		FinishReason: finishReason,
	}

	totalAttempts := len(routeNodes)
	if totalAttempts < 1 {
		totalAttempts = 1
	}

	// --- Write flat trace to new typed table ---
	_ = db.SaveTrace(&db.FlatTrace{
		ID:             ctx.RequestID,
		Status:         statusStr,
		Provider:       providerName,
		Model:          modelName,
		Route:          comboKind,
		Node:           selectedNode,
		RouteNodes:     routeNodes,
		Attempt:        attempt,
		TotalAttempts:  totalAttempts,
		LatencyMs:      latMs,
		TtfbMs:         ttfbMs,
		InputTokens:    ctx.PromptTokens,
		OutputTokens:   ctx.CompletionTokens,
		CachedTokens:   ctx.CachedTokens,
		Compression:    compressionPct,
		Cache:          cacheStatus,
		Cost:           ctx.Cost,
		IsStream:       ctx.IsStream,
		RetryCount:     ctx.RetryCount,
		FallbackCount:  ctx.FallbackCount,
		TargetAttempts: attempts,
		Pipeline:       pipelineSteps,
		RequestMeta:    reqMeta,
		ResponseMeta:   respMeta,
		Request:        requestStr,
		Response:       respPreview,
	})

	return err
}

func extractResponsePreview(body []byte, maxLen int) string {
	if len(body) == 0 {
		return ""
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(body, &resp); err != nil {
		return ""
	}
	if choices, ok := resp["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if msg, ok := choice["message"].(map[string]interface{}); ok {
				if content, ok := msg["content"].(string); ok {
					trimmed := strings.TrimSpace(content)
					if len(trimmed) > maxLen {
						return trimmed[:maxLen] + "...[TRUNCATED]"
					}
					return trimmed
				}
			}
		}
	}
	// Handle error responses (e.g., 403, 401, etc.)
	if errObj, ok := resp["error"].(map[string]interface{}); ok {
		if msg, ok := errObj["message"].(string); ok && msg != "" {
			trimmed := strings.TrimSpace(msg)
			if len(trimmed) > maxLen {
				return trimmed[:maxLen] + "...[TRUNCATED]"
			}
			return trimmed
		}
		if code, ok := errObj["code"].(float64); ok {
			return fmt.Sprintf("Error code: %.0f", code)
		}
	}
	return ""
}

func extractFinishReason(body []byte) string {
	if len(body) == 0 {
		return "unknown"
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(body, &resp); err != nil {
		return "unknown"
	}
	if choices, ok := resp["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if reason, ok := choice["finish_reason"].(string); ok && reason != "" {
				return reason
			}
		}
	}
	// Handle error responses (e.g., 403, 401, etc.)
	if _, ok := resp["error"].(map[string]interface{}); ok {
		return "error"
	}
	return "stop"
}

type TracePreview struct {
	System string `json:"system,omitempty"`
	User   string `json:"user,omitempty"`
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
		content := extractTextFromContent(msgMap["content"])
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

func extractTextFromContent(v interface{}) string {
	if str, ok := v.(string); ok {
		return str
	}
	if arr, ok := v.([]interface{}); ok {
		var parts []string
		for _, item := range arr {
			if partMap, ok := item.(map[string]interface{}); ok {
				if text, ok := partMap["text"].(string); ok && text != "" {
					if strings.Contains(text, "<environment_details>") {
						idx := strings.Index(text, "<environment_details>")
						if idx > 0 {
							text = strings.TrimSpace(text[:idx])
						} else if endIdx := strings.Index(text, "</environment_details>"); endIdx != -1 {
							text = strings.TrimSpace(text[endIdx+len("</environment_details>"):])
						}
					}
					if text != "" {
						parts = append(parts, text)
					}
				}
			} else if strItem, ok := item.(string); ok && strItem != "" {
				parts = append(parts, strItem)
			}
		}
		if len(parts) > 0 {
			return strings.Join(parts, "\n")
		}
	} else if itemMap, ok := v.(map[string]interface{}); ok {
		if text, ok := itemMap["text"].(string); ok {
			return text
		}
	}
	return ""
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
			if k == "reasoning_content" {
				if str, ok := v.(string); ok {
					if len(str) > 256 {
						cloned[k] = str[:256] + "...[TRUNCATED REASONING]"
					} else {
						cloned[k] = str
					}
				}
				continue
			}

			if k == "content" {
				if str, ok := v.(string); ok {
					if len(str) > 500 {
						cloned[k] = str[:500] + "...[TRUNCATED]"
					} else {
						cloned[k] = str
					}
				} else if arr, ok := v.([]interface{}); ok {
					clonedArr := make([]interface{}, 0, len(arr))
					for _, item := range arr {
						if partMap, ok := item.(map[string]interface{}); ok {
							clonedPart := make(map[string]interface{}, len(partMap))
							for pk, pv := range partMap {
								if pk == "text" {
									if textStr, ok := pv.(string); ok {
										if len(textStr) > 500 {
											clonedPart[pk] = textStr[:500] + "...[TRUNCATED]"
										} else {
											clonedPart[pk] = pv
										}
									} else {
										clonedPart[pk] = pv
									}
								} else {
									clonedPart[pk] = pv
								}
							}
							clonedArr = append(clonedArr, clonedPart)
						} else {
							clonedArr = append(clonedArr, item)
						}
					}
					cloned[k] = clonedArr
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
