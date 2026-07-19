package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"myAiRouter/pkg/db"
)

type GeminiProvider struct{}

func init() {
	Register(&GeminiProvider{})
}

func (p *GeminiProvider) Name() string {
	return "gemini"
}

func (p *GeminiProvider) Execute(ctx context.Context, conn *db.ProviderConnection, body map[string]interface{}) *ExecutionResult {
	apiKey, _ := conn.Data["apiKey"].(string)
	if apiKey == "" {
		apiKey = conn.Name
	}
	stream, _ := body["stream"].(bool)

	model, _ := body["model"].(string)
	if model == "" {
		model = "gemini-1.5-flash"
	}
	if strings.Contains(model, "/") {
		model = model[strings.LastIndex(model, "/")+1:]
	}

	var url string
	if stream {
		url = fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:streamGenerateContent?key=%s", model, apiKey)
	} else {
		url = fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", model, apiKey)
	}

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

	// Inject custom headers
	if headers, ok := conn.Data["headers"].(map[string]interface{}); ok {
		for k, v := range headers {
			if valStr, ok := v.(string); ok {
				req.Header.Set(k, valStr)
			}
		}
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
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
