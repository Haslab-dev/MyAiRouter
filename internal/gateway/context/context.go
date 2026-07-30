package context

import (
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"time"

	"myAiRouter/pkg/db"
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

	// Connection details
	Connection *db.ProviderConnection

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
	c.ResponseCode = code
	c.ResponseWriter.Header().Set("Content-Type", "application/json")
	c.ResponseWriter.WriteHeader(code)
	_ = json.NewEncoder(c.ResponseWriter).Encode(data)
}

func (c *GatewayContext) CloneForTarget(ctx context.Context, conn *db.ProviderConnection, model string, provider string, body map[string]interface{}) *GatewayContext {
	body["model"] = model
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
		Metadata:       c.Metadata,
		StartTime:      time.Now(),
		LastStepTime:   time.Now(),
		Steps:          make([]TraceStep, 0),
	}
}

func (c *GatewayContext) MergeStepsFrom(child *GatewayContext) {
	if child != nil && len(child.Steps) > 0 {
		c.Steps = append(c.Steps, child.Steps...)
	}
}
