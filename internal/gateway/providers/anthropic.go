package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"myAiRouter/pkg/db"
)

type AnthropicProvider struct{}

func init() {
	Register(&AnthropicProvider{})
}

func (p *AnthropicProvider) Name() string {
	return "anthropic"
}

func (p *AnthropicProvider) Execute(ctx context.Context, conn *db.ProviderConnection, body map[string]interface{}) *ExecutionResult {
	apiKey, _ := conn.Data["apiKey"].(string)
	if apiKey == "" {
		apiKey = conn.Name
	}
	stream, _ := body["stream"].(bool)

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

	// Inject custom headers
	if headers, ok := conn.Data["headers"].(map[string]interface{}); ok {
		for k, v := range headers {
			if valStr, ok := v.(string); ok {
				req.Header.Set(k, valStr)
			}
		}
	}

	resp, err := SharedHTTPClient.Do(req)
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
