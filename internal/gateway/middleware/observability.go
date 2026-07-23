package middleware

import (
	"encoding/json"
	"math"
	"strings"
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
ctx.RPS = math.Round(db.GetCurrentRPS()*100) / 100
latSec := ctx.Latency.Seconds()
if latSec <= 0 {
	latSec = 0.001
}
ctx.TPS = math.Round((float64(ctx.PromptTokens+ctx.CompletionTokens)/latSec)*10) / 10
ctx.AddStep("Observability Engine", "success", "Recording pipeline details")

statusStr := "ok"
if ctx.ResponseCode >= 400 || err != nil {
	statusStr = "error"
}

// Calculate upstream API cost
ctx.Cost = db.CalculateCost(ctx.Provider, ctx.Model, ctx.PromptTokens, ctx.CompletionTokens, ctx.CachedTokens)

// Extract pipeline steps with structured details
type stepLog struct {
	Name       string  `json:"name"`
	DurationMs int64   `json:"durationMs"`
	Status     string  `json:"status"`
	Details    string  `json:"details"`
	Error      string  `json:"error,omitempty"`
	RPS        float64 `json:"rps"`
	TPS        float64 `json:"tps"`
}
steps := make([]stepLog, 0, len(ctx.Steps))
for _, s := range ctx.Steps {
	steps = append(steps, stepLog{
		Name:       s.Name,
		DurationMs: s.DurationMs,
		Status:     s.Status,
		Details:    s.Details,
		Error:      s.Error,
		RPS:        s.RPS,
		TPS:        s.TPS,
	})
}

// Aggregate metrics for standard usage tracking
metaMap := map[string]interface{}{
	"duration_ms": ctx.Latency.Milliseconds(),
	"ttfb_ms":     ctx.TTFB.Milliseconds(),
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

// Check trace storage settings
settings, _ := db.GetSettings()
if settings != nil && (settings.TraceStorageMode == "disabled" || settings.TraceStorageMode == "off") {
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
	"rps":              ctx.RPS,
	"tps":              ctx.TPS,
	"steps":            steps,
	"errors":           ctx.Errors,
	"preview":          preview,
}

// Attach a single messages array (no duplication of original vs optimized) if preview or full mode is active
mode := "summary"
if settings != nil && settings.TraceStorageMode != "" {
mode = settings.TraceStorageMode
}

if mode == "preview" || mode == "full" {
if msgs, ok := ctx.RequestBody["messages"].([]interface{}); ok {
traceData["messages"] = truncateMessagesForTrace(msgs)
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
// Strip verbose environment_details wrapper if other prompt content exists
if strings.Contains(text, "<environment_details>") {
idx := strings.Index(text, "<environment_details>")
if idx > 0 {
text = strings.TrimSpace(text[:idx])
}
}
if text != "" {
parts = append(parts, text)
}
}
}
}
if len(parts) > 0 {
return strings.Join(parts, "\n")
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
// Cap reasoning content to 256 chars max
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
