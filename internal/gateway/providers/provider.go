package providers

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"time"

	"myAiRouter/pkg/db"
)

var SharedTransport = &http.Transport{
	MaxIdleConns:        200,
	MaxIdleConnsPerHost: 100,
	IdleConnTimeout:     90 * time.Second,
	ForceAttemptHTTP2:   true,
	DialContext: (&net.Dialer{
		Timeout:   5 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext,
}

// ClientFor returns an outbound client honoring the proxy route attached to
// the connection (if any), else the shared direct client.
func ClientFor(conn *db.ProviderConnection) *http.Client {
	if conn == nil {
		return SharedHTTPClient
	}
	route, err := db.ProxyRouteForConnection(conn)
	if err != nil || route == nil || !route.IsEnabled || route.Host == "" || route.Port == 0 {
		return SharedHTTPClient
	}
	return proxyManager.clientFor(route)
}

var SharedHTTPClient = &http.Client{
	Transport: SharedTransport,
	Timeout:   120 * time.Second,
}

type ExecutionResult struct {
	ResponseCode int
	Body         []byte
	Stream       io.ReadCloser
	IsStream     bool
	LatencyMs    float64
	Err          error
}

type CacheCapabilities struct {
	Supported     bool `json:"supported"`
	PrefixCaching bool `json:"prefix_caching"`
	ReportsTokens bool `json:"reports_tokens"`
	ReportsHit    bool `json:"reports_hit"`
}

type ProviderCapabilities struct {
	PromptCache CacheCapabilities `json:"prompt_cache"`
}

type Provider interface {
	Name() string
	Execute(ctx context.Context, conn *db.ProviderConnection, body map[string]interface{}) *ExecutionResult
	Capabilities(conn *db.ProviderConnection) ProviderCapabilities
}

var Registry = make(map[string]Provider)

func Register(p Provider) {
	Registry[p.Name()] = p
}

func Get(name string) Provider {
	return Registry[name]
}

// providerRestrictedFields lists request body fields that specific providers
// reject because they use strict ("extra inputs are not permitted") validation.
// These are stripped before forwarding, so clients built for OpenAI-compatible
// APIs don't break against stricter providers.
var providerRestrictedFields = map[string]map[string]bool{
	"mistral": {"store": true},
}

// SanitizeRequestBody removes fields the target provider does not accept.
func SanitizeRequestBody(provider string, body map[string]interface{}) {
	if body == nil {
		return
	}
	if restricted, ok := providerRestrictedFields[provider]; ok {
		for field := range restricted {
			delete(body, field)
		}
	}
}

// RejectedFieldsFrom422 parses a FastAPI-style 422 validation error and returns
// the top-level body fields that were rejected as "extra_forbidden".
func RejectedFieldsFrom422(respBody []byte) []string {
	var parsed struct {
		Detail []struct {
			Type string `json:"type"`
			Loc  []any  `json:"loc"`
		} `json:"detail"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil
	}
	var fields []string
	for _, d := range parsed.Detail {
		if d.Type != "extra_forbidden" || len(d.Loc) < 2 {
			continue
		}
		// loc looks like ["body", "store"] (possibly nested: ["body","a","b"])
		if loc0, ok := d.Loc[0].(string); !ok || loc0 != "body" {
			continue
		}
		if field, ok := d.Loc[1].(string); ok && field != "" {
			fields = append(fields, field)
		}
	}
	return fields
}
