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

func (p *OpenAIProvider) Capabilities(conn *db.ProviderConnection) ProviderCapabilities {
	if conn == nil {
		return ProviderCapabilities{PromptCache: CacheCapabilities{Supported: true, PrefixCaching: true, ReportsTokens: true, ReportsHit: false}}
	}
	if conn.Provider == "deepseek" || conn.Provider == "openai" {
		return ProviderCapabilities{PromptCache: CacheCapabilities{Supported: true, PrefixCaching: true, ReportsTokens: true, ReportsHit: false}}
	}
	return ProviderCapabilities{PromptCache: CacheCapabilities{Supported: false, PrefixCaching: false, ReportsTokens: false, ReportsHit: false}}
}

func (p *OpenAIProvider) Execute(ctx context.Context, conn *db.ProviderConnection, body map[string]interface{}) *ExecutionResult {
	apiKey, _ := conn.Data["apiKey"].(string)
	if oauthTok, err := OAuthAccessToken(conn); err == nil && oauthTok != "" {
		apiKey = oauthTok // OAuth connection: token wins over any stored key
	}
	if apiKey == "" {
		apiKey = conn.Name
	}
	// OAuth connections sometimes need a forced upstream model id
	// (e.g. Grok Build) — see oauth_registry.go.
	if oauthAlias := OAuthModelAlias(conn); oauthAlias != "" {
		body["model"] = oauthAlias
	}
	stream, _ := body["stream"].(bool)

	baseUrl, _ := conn.Data["baseUrl"].(string)
	if baseUrl == "" {
		if oauthBase := OAuthBaseURL(conn); oauthBase != "" {
			baseUrl = oauthBase
		} else {
			switch conn.Provider {
			case "groq":
				baseUrl = "https://api.groq.com/openai/v1"
			case "nvidia":
				baseUrl = "https://integrate.api.nvidia.com/v1"
			case "openrouter":
				baseUrl = "https://openrouter.ai/api/v1"
			case "deepseek":
				baseUrl = "https://api.deepseek.com/v1"
			case "glm":
				baseUrl = "https://open.bigmodel.cn/api/paas/v4"
			case "glm-coding":
				baseUrl = "https://open.bigmodel.cn/api/coding/paas/v4"
			case "cerebras":
				baseUrl = "https://api.cerebras.ai/v1"
			case "opencode-zen", "opencode":
				baseUrl = "https://opencode.ai/zen/v1"
			case "opencode-go":
				baseUrl = "https://opencode.ai/zen/go/v1"
			default:
				baseUrl = "https://api.openai.com/v1"
			}
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
	// OAuth per-provider spoof headers land before custom headers so
	// connection-level overrides (if any) still win.
	for k, v := range OAuthHeaders(conn) {
		req.Header.Set(k, v)
	}
	if conn.Provider == "opencode" || conn.Provider == "opencode-go" {
		req.Header.Set("x-opencode-client", "desktop")
	}
	if conn.Provider == "kilocode" {
		if orgId, ok := conn.Data["orgId"].(string); ok && orgId != "" {
			req.Header.Set("X-Kilocode-OrganizationID", orgId)
		}
	}

	// Inject custom headers
	if headers, ok := conn.Data["headers"].(map[string]interface{}); ok {
		for k, v := range headers {
			if valStr, ok := v.(string); ok {
				req.Header.Set(k, valStr)
			}
		}
	}

	ApplyAntiDetect(req, conn)

	start := time.Now()
	resp, err := ClientFor(conn).Do(req)
	latencyMs := float64(time.Since(start).Microseconds()) / 1000.0
	if err != nil {
		return &ExecutionResult{Err: err}
	}

	if stream && resp.StatusCode == http.StatusOK {
		return &ExecutionResult{
			ResponseCode: resp.StatusCode,
			Stream:       resp.Body,
			IsStream:     true,
			LatencyMs:    latencyMs,
		}
	}

	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	return &ExecutionResult{
		ResponseCode: resp.StatusCode,
		Body:         respBody,
		IsStream:     false,
		LatencyMs:    latencyMs,
		Err:          err,
	}
}
