package gateway

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"myAiRouter/pkg/db"
)

var sharedHTTPClient = &http.Client{
	Transport: &http.Transport{
		MaxIdleConns:        50,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
	},
	Timeout: 120 * time.Second,
}

type ExecutionResult struct {
	ResponseCode int
	Body         []byte
	Stream       io.ReadCloser
	IsStream     bool
	Err          error
}

func ExecuteProviderRequest(ctx context.Context, conn *db.ProviderConnection, body map[string]interface{}) *ExecutionResult {
	provider := conn.Provider
	apiKey, _ := conn.Data["apiKey"].(string)
	if apiKey == "" {
		// Fallback to connection top level if set
		apiKey = conn.Name // some fallback
	}

	stream, _ := body["stream"].(bool)

	switch provider {
	case "anthropic":
		return executeAnthropic(ctx, conn, apiKey, body, stream)
	case "gemini":
		return executeGemini(ctx, conn, apiKey, body, stream)
	case "commandcode":
		return executeCommandCode(ctx, apiKey, body, stream)
	default:
		// Default to OpenAI compatible format
		return executeOpenAI(ctx, conn, apiKey, body, stream)
	}
}

func executeOpenAI(ctx context.Context, conn *db.ProviderConnection, apiKey string, body map[string]interface{}, stream bool) *ExecutionResult {
	baseUrl, _ := conn.Data["baseUrl"].(string)
	if baseUrl == "" {
		// Default base URLs
		switch conn.Provider {
		case "groq":
			baseUrl = "https://api.groq.com/openai/v1"
		case "nvidia":
			baseUrl = "https://integrate.api.nvidia.com/v1"
		case "openrouter":
			baseUrl = "https://openrouter.ai/api/v1"
		case "deepseek":
			baseUrl = "https://api.deepseek.com/v1"
		case "opencode-zen", "opencode":
			baseUrl = "https://opencode.ai/zen/v1"
		case "opencode-go":
			baseUrl = "https://opencode.ai/zen/go/v1"
		case "kenari":
			baseUrl = "https://kenari.id/v1"
		case "sumopod":
			baseUrl = "https://ai.sumopod.com/v1"
		case "mistral":
			baseUrl = "https://api.mistral.ai/v1"
		case "meta":
			baseUrl = "https://api.meta.ai/v1"
		case "ollama":
			baseUrl = "http://localhost:11434/v1"
		case "qwen":
			baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1"
		case "tencent":
			baseUrl = "https://api.hunyuan.cloud.tencent.com/v1"
		case "vercel":
			baseUrl = "https://api.vercel.ai/v1"
		case "fireworks":
			baseUrl = "https://api.fireworks.ai/inference/v1"
		case "cloudflare-ai":
			baseUrl = "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1"
		default:
			baseUrl = "https://api.openai.com/v1"
		}
	}

	url := strings.TrimSuffix(baseUrl, "/") + "/chat/completions"
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return &ExecutionResult{Err: fmt.Errorf("marshalling body: %w", err)}
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return &ExecutionResult{Err: err}
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	if conn.Provider == "opencode" || conn.Provider == "opencode-go" {
		req.Header.Set("x-opencode-client", "desktop")
	}
	if conn.Provider == "kilocode" {
		if orgId, ok := conn.Data["orgId"].(string); ok && orgId != "" {
			req.Header.Set("X-Kilocode-OrganizationID", orgId)
		}
	}

	resp, err := sharedHTTPClient.Do(req)
	if err != nil {
		return &ExecutionResult{Err: err}
	}

	if stream && resp.StatusCode == http.StatusOK {
		return &ExecutionResult{
			ResponseCode: resp.StatusCode,
			Stream:       resp.Body,
			IsStream:     true,
		}
	}

	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	return &ExecutionResult{
		ResponseCode: resp.StatusCode,
		Body:         respBody,
		IsStream:     false,
		Err:          err,
	}
}

// executeCommandCode streams to the documented Command Code Provider API
// (OpenAI-compatible: https://api.commandcode.ai/provider/v1/chat/completions).
func executeCommandCode(ctx context.Context, apiKey string, body map[string]interface{}, stream bool) *ExecutionResult {
	url := "https://api.commandcode.ai/provider/v1/chat/completions"

	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return &ExecutionResult{Err: fmt.Errorf("marshalling body: %w", err)}
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return &ExecutionResult{Err: err}
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "text/event-stream")

	resp, err := sharedHTTPClient.Do(req)
	if err != nil {
		return &ExecutionResult{Err: err}
	}

	if stream && resp.StatusCode == http.StatusOK {
		return &ExecutionResult{
			ResponseCode: resp.StatusCode,
			Stream:       resp.Body,
			IsStream:     true,
		}
	}

	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	return &ExecutionResult{
		ResponseCode: resp.StatusCode,
		Body:         respBody,
		IsStream:     false,
		Err:          err,
	}
}

func executeAnthropic(ctx context.Context, conn *db.ProviderConnection, apiKey string, body map[string]interface{}, stream bool) *ExecutionResult {
	baseUrl, _ := conn.Data["baseUrl"].(string)
	if baseUrl == "" {
		baseUrl = "https://api.anthropic.com/v1"
	}

	url := strings.TrimSuffix(baseUrl, "/") + "/messages"
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return &ExecutionResult{Err: err}
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return &ExecutionResult{Err: err}
	}

	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := sharedHTTPClient.Do(req)
	if err != nil {
		return &ExecutionResult{Err: err}
	}

	if stream && resp.StatusCode == http.StatusOK {
		return &ExecutionResult{
			ResponseCode: resp.StatusCode,
			Stream:       resp.Body,
			IsStream:     true,
		}
	}

	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	return &ExecutionResult{
		ResponseCode: resp.StatusCode,
		Body:         respBody,
		IsStream:     false,
		Err:          err,
	}
}

func executeGemini(ctx context.Context, conn *db.ProviderConnection, apiKey string, body map[string]interface{}, stream bool) *ExecutionResult {
	model, _ := body["model"].(string)
	if model == "" {
		model = "gemini-1.5-flash"
	}
	// Strip brand prefix if present
	if strings.Contains(model, "/") {
		model = model[strings.LastIndex(model, "/")+1:]
	}

	var url string
	if stream {
		url = fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:streamGenerateContent?key=%s", model, apiKey)
	} else {
		url = fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", model, apiKey)
	}

	// Map OpenAI format to Gemini if input is OpenAI
	var geminiReq map[string]interface{}
	if _, isGemini := body["contents"]; isGemini {
		geminiReq = body
	} else {
		geminiReq = OpenAIToGemini(body)
	}

	bodyBytes, err := json.Marshal(geminiReq)
	if err != nil {
		return &ExecutionResult{Err: err}
	}

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return &ExecutionResult{Err: err}
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := sharedHTTPClient.Do(req)
	if err != nil {
		return &ExecutionResult{Err: err}
	}

	if stream && resp.StatusCode == http.StatusOK {
		return &ExecutionResult{
			ResponseCode: resp.StatusCode,
			Stream:       resp.Body,
			IsStream:     true,
		}
	}

	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	return &ExecutionResult{
		ResponseCode: resp.StatusCode,
		Body:         respBody,
		IsStream:     false,
		Err:          err,
	}
}

func extractStreamUsage(line string) (promptTokens, completionTokens, cachedTokens int) {
	if strings.HasPrefix(line, "data: ") {
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			return 0, 0, 0
		}
		var chunk map[string]interface{}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return 0, 0, 0
		}
		if usage, ok := chunk["usage"].(map[string]interface{}); ok {
			if p, ok := usage["prompt_tokens"].(float64); ok && p > 0 {
				promptTokens = int(p)
			} else if p, ok := usage["input_tokens"].(float64); ok && p > 0 {
				promptTokens = int(p)
			} else if p, ok := usage["prompt_eval_count"].(float64); ok && p > 0 {
				promptTokens = int(p)
			}

			if c, ok := usage["completion_tokens"].(float64); ok && c > 0 {
				completionTokens = int(c)
			} else if c, ok := usage["output_tokens"].(float64); ok && c > 0 {
				completionTokens = int(c)
			} else if c, ok := usage["eval_count"].(float64); ok && c > 0 {
				completionTokens = int(c)
			}

			// Try common cached token field names at top level
			for _, key := range []string{"cache_creation_input_tokens", "cache_read_input_tokens", "cached_tokens"} {
				if v, ok := usage[key].(float64); ok {
					cachedTokens += int(v)
				}
			}
			// Try nested details
			if details, ok := usage["prompt_tokens_details"].(map[string]interface{}); ok {
				for _, key := range []string{"cache_creation_input_tokens", "cache_read_input_tokens", "cached_tokens"} {
					if v, ok := details[key].(float64); ok {
						cachedTokens += int(v)
					}
				}
			}
		}

		if promptTokens == 0 {
			if p, ok := chunk["prompt_eval_count"].(float64); ok && p > 0 {
				promptTokens = int(p)
			}
		}
		if completionTokens == 0 {
			if c, ok := chunk["eval_count"].(float64); ok && c > 0 {
				completionTokens = int(c)
			}
		}

		if promptTokens > 0 || completionTokens > 0 || cachedTokens > 0 {
			return promptTokens, completionTokens, cachedTokens
		}
	}
	return 0, 0, 0
}

// Helper to write error response
func WriteErrorResponse(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]interface{}{
			"message": msg,
			"type":    "api_error",
		},
	})
}

// SSE stream writer
func HandleSSEStream(w http.ResponseWriter, r *http.Request, stream io.ReadCloser, format string) (int, int, int, error) {
	defer stream.Close()
	flusher, ok := w.(Flusher)
	if !ok {
		return 0, 0, 0, fmt.Errorf("response writer does not support flushing")
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	scanner := bufio.NewScanner(stream)
	promptTokens := 0
	completionTokens := 0
	cachedTokens := 0

	totalChars := 0
	chunkCount := 0

	for scanner.Scan() {
		line := scanner.Text()
		if len(line) == 0 {
			continue
		}

		// Extract usage from stream final chunk (OpenAI format)
		if pt, ct, cat := extractStreamUsage(line); pt > 0 || ct > 0 || cat > 0 {
			if pt > 0 {
				promptTokens = pt
			}
			if ct > 0 {
				completionTokens = ct
			}
			if cat > 0 {
				cachedTokens = cat
			}
		}

		var outputLine []byte
		var done bool

		switch format {
		case "claude":
			outputLine, done = TranslateClaudeChunkToOpenAI([]byte(line))
		case "gemini":
			outputLine, done = TranslateGeminiChunkToOpenAI([]byte(line))
		default:
			outputLine = []byte(line + "\n\n")
			if strings.HasSuffix(line, "[DONE]") {
				done = true
			}
		}

		if len(outputLine) > 0 {
			_, _ = w.Write(outputLine)
			flusher.Flush()
			totalChars += len(outputLine)
			chunkCount++
		}

		if done {
			break
		}
	}

	if completionTokens <= 0 {
		if totalChars > 0 {
			completionTokens = int(math.Max(1, math.Ceil(float64(totalChars)/10.0)))
		} else if chunkCount > 0 {
			completionTokens = chunkCount
		} else {
			completionTokens = 1
		}
	}

	return promptTokens, completionTokens, cachedTokens, scanner.Err()
}

type Flusher interface {
	Flush()
}
