package context

import (
	"context"
	"encoding/json"
	"io"
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
	Metadata         map[string]any

	// Middleware Pipeline Tracking
	Steps            []TraceStep
	StartTime        time.Time
	LastStepTime     time.Time

	// HTTP / Upstream properties
	ResponseWriter   http.ResponseWriter
	Request          *http.Request
	RequestBody      map[string]interface{}
	ResponseCode     int
	ResponseBody     []byte
	IsStream         bool
	Stream           io.ReadCloser

	// Connection details
	Connection       *db.ProviderConnection

	// Fallback/Retry state
	RetryCount       int
	FallbackCount    int
	Errors           []string
}

func NewGatewayContext(w http.ResponseWriter, r *http.Request) *GatewayContext {
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
	now := time.Now()
	dur := now.Sub(c.LastStepTime)
	c.Steps = append(c.Steps, TraceStep{
		Name:       name,
		Timestamp:  now,
		DurationMs: dur.Milliseconds(),
		Status:     status,
		Details:    details,
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
