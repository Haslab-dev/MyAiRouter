package context

import (
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"time"

	"myAiRouter/pkg/db"
	pkgGateway "myAiRouter/pkg/gateway"
)

type TraceStep struct {
	Name       string    `json:"name"`
	Timestamp  time.Time `json:"timestamp"`
	DurationMs int64     `json:"durationMs"`
	Status     string    `json:"status"`
	Details    string    `json:"details"`
	Error      string    `json:"error,omitempty"`
	RPS        float64   `json:"rps"`
	TPS        float64   `json:"tps"`
}

type TargetAttempt struct {
	Index        int    `json:"index"`
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	ConnectionID string `json:"connectionId"`
	Status       string `json:"status"` // "success", "failed", "skipped", "winner", "cancelled"
	ResponseCode int    `json:"responseCode"`
	DurationMs   int64  `json:"durationMs"`
	Error        string `json:"error,omitempty"`
}

type GatewayContext struct {
	Context          context.Context
	RequestID        string
	UserID           string
	Model            string
	OriginalModel    string
	Provider         string
	PromptTokens     int
	CompletionTokens int
	CachedTokens     int
	Cost             float64
	Latency          time.Duration
	TTFB             time.Duration
	RPS              float64
	TPS              float64
	Metadata         map[string]any

	// Middleware Pipeline Tracking
	Steps          []TraceStep
	TargetAttempts []TargetAttempt
	StartTime      time.Time
	LastStepTime   time.Time

	// HTTP / Upstream properties
	ResponseWriter http.ResponseWriter
	Request        *http.Request
	RequestBody    map[string]interface{}
	ResponseCode   int
	ResponseBody   []byte
	IsStream       bool
	Stream         io.ReadCloser

	// ResponseWritten tracks whether the client socket already received
	// headers+body (WriteError/WriteJSON/Provider relay). The fallback engine
	// checks it to avoid double-writing a second JSON error after Guardrail
	// or a previous attempt already responded.
	ResponseWritten bool

	// Connection details
	Connection *db.ProviderConnection

	// Live-activity tracking key (see pkg/gateway/live.go). Empty means this
	// context is not tracked — the passthrough/auth-only contexts and every
	// test-built context take that path and pay nothing.
	LiveID       string
	LiveFinished bool

	// Fallback/Retry state
	RetryCount    int
	FallbackCount int
	Errors        []string
}

func NewGatewayContext(w http.ResponseWriter, r *http.Request) *GatewayContext {
	db.RecordRequestMetric()
	now := time.Now()
	return &GatewayContext{
		Context:        r.Context(),
		StartTime:      now,
		LastStepTime:   now,
		ResponseWriter: w,
		Request:        r,
		Metadata:       make(map[string]any),
		Steps:          make([]TraceStep, 0),
	}
}

// BeginLiveActivity opens the live-activity record the Overview animation
// reads. It is deliberately driven by the caller (which knows the request id
// and model) rather than by NewGatewayContext, because the passthrough
// endpoints build a context for auth only and would otherwise emit phantom
// sessions. Safe to call with an empty id: it becomes a no-op.
func (c *GatewayContext) BeginLiveActivity(model string) {
	c.LiveID = pkgGateway.BeginActivity(c.RequestID, model, c.Request.URL.Path)
}

// FinishLiveActivity closes the record with the final accounting. Nil-safe:
// contexts built by tests (no RequestID) simply skip it.
func (c *GatewayContext) FinishLiveActivity() {
	if c.LiveID == "" || c.LiveFinished {
		return
	}
	c.LiveFinished = true
	ok := c.ResponseCode < 400
	pkgGateway.FinishActivity(c.LiveID, c.ResponseCode, ok, c.PromptTokens, c.CompletionTokens, c.CachedTokens)
}

// TrackStep mirrors one pipeline step into the live record so the Overview
// can show *which* stage is running, not just a spinner.
func (c *GatewayContext) TrackStep(step string) {
	if c.LiveID == "" {
		return
	}
	pkgGateway.SetStep(c.LiveID, step)
}

func (c *GatewayContext) AddStep(name string, status string, details string) {
	c.AddStepWithError(name, status, details, "")
}

func (c *GatewayContext) AddStepWithError(name string, status string, details string, errStr string) {
	now := time.Now()
	dur := now.Sub(c.LastStepTime)
	durSec := dur.Seconds()
	if durSec <= 0 {
		durSec = 0.001
	}

	totalTokens := c.PromptTokens + c.CompletionTokens
	tps := 0.0
	if totalTokens > 0 {
		tps = float64(totalTokens) / durSec
	}

	rps := db.GetCurrentRPS()

	c.Steps = append(c.Steps, TraceStep{
		Name:       name,
		Timestamp:  now,
		DurationMs: dur.Milliseconds(),
		Status:     status,
		Details:    details,
		Error:      errStr,
		RPS:        math.Round(rps*100) / 100,
		TPS:        math.Round(tps*10) / 10,
	})
	c.LastStepTime = now
}

func (c *GatewayContext) WriteError(code int, msg string) {
	if c.ResponseWritten {
		return
	}
	c.ResponseWritten = true
	c.ResponseCode = code
	c.ResponseWriter.Header().Set("Content-Type", "application/json")
	c.ResponseWriter.WriteHeader(code)
	_ = json.NewEncoder(c.ResponseWriter).Encode(map[string]interface{}{
		"error": map[string]interface{}{
			"message": msg,
			"type":    "api_error",
		},
	})
}

func (c *GatewayContext) WriteJSON(code int, data interface{}) {
	if c.ResponseWritten {
		return
	}
	c.ResponseWritten = true
	c.ResponseCode = code
	c.ResponseWriter.Header().Set("Content-Type", "application/json")
	c.ResponseWriter.WriteHeader(code)
	_ = json.NewEncoder(c.ResponseWriter).Encode(data)
}

func (c *GatewayContext) CloneForTarget(ctx context.Context, conn *db.ProviderConnection, model string, provider string, body map[string]interface{}) *GatewayContext {
	body["model"] = model
	// Shallow-copy metadata so concurrent child attempts never race on the
	// parent's map; winners merge selected keys back explicitly.
	metadataCopy := make(map[string]any, len(c.Metadata))
	for k, v := range c.Metadata {
		metadataCopy[k] = v
	}
	return &GatewayContext{
		Context:        ctx,
		RequestID:      c.RequestID,
		UserID:         c.UserID,
		Model:          model,
		OriginalModel:  c.OriginalModel,
		Provider:       provider,
		Connection:     conn,
		ResponseWriter: c.ResponseWriter,
		Request:        c.Request,
		RequestBody:    body,
		IsStream:       c.IsStream,
		Metadata:       metadataCopy,
		StartTime:      time.Now(),
		LastStepTime:   time.Now(),
		Steps:          make([]TraceStep, 0),
		// Child attempts share the parent's live-activity record: from the
		// operator's point of view one client request is one session, even
		// when a combo fans it out to N upstreams.
		LiveID: c.LiveID,
	}
}

func (c *GatewayContext) MergeStepsFrom(child *GatewayContext) {
	if child != nil && len(child.Steps) > 0 {
		c.Steps = append(c.Steps, child.Steps...)
	}
}
