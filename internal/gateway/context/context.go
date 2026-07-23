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
	Steps        []TraceStep
	StartTime    time.Time
	LastStepTime time.Time

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
