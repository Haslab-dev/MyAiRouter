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

type OpenAIProvider struct{}

func init() {
	Register(&OpenAIProvider{})
}

func (p *OpenAIProvider) Name() string {
	return "openai"
}

func (p *OpenAIProvider) Execute(ctx context.Context, conn *db.ProviderConnection, body map[string]interface{}) *ExecutionResult {
	apiKey, _ := conn.Data["apiKey"].(string)
	if apiKey == "" {
		apiKey = conn.Name
	}
	stream, _ := body["stream"].(bool)

	baseUrl, _ := conn.Data["baseUrl"].(string)
	if baseUrl == "" {
		switch conn.Provider {
		case "groq":
			baseUrl = "https://api.groq.com/openai/v1"
		case "openrouter":
			baseUrl = "https://openrouter.ai/api/v1"
		case "deepseek":
			baseUrl = "https://api.deepseek.com/v1"
		case "glm":
			baseUrl = "https://open.bigmodel.cn/api/paas/v4"
		case "glm-coding":
			baseUrl = "https://open.bigmodel.cn/api/coding/paas/v4"
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
