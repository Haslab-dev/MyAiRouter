package providers

import (
	"strings"

	"myAiRouter/pkg/db"
)

// Registry mirror of the login-flow declarations in pkg/gateway
// (oauth_providers.go), for the request path: token endpoints, chat base
// URLs, and per-provider header quirks. Kept here (not imported from
// pkg/gateway) because internal/* cannot import pkg/gateway
// (import cycle via middleware -> pkg/gateway -> middleware).

type oauthDef struct {
	ClientID   string
	Scope      string
	TokenURL   string
	RefreshURL string
	BaseURL    string
	AuthType   string // openai | claude | responses
	ModelAlias string
	Headers    map[string]string
}

var oauthDefs = map[string]oauthDef{
	"xai": {
		ClientID: "b1a00492-073a-47ea-816f-4c329264a828",
		Scope:    "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write",
		TokenURL: "https://auth.x.ai/oauth2/token", RefreshURL: "https://auth.x.ai/oauth2/token",
		BaseURL: "https://api.x.ai/v1", AuthType: "openai",
	},
	"grok-cli": {
		ClientID: "b1a00492-073a-47ea-816f-4c329264a828",
		Scope:    "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write",
		TokenURL: "https://auth.x.ai/oauth2/token", RefreshURL: "https://auth.x.ai/oauth2/token",
		BaseURL: "https://cli-chat-proxy.grok.com/v1", AuthType: "responses", ModelAlias: "grok-build",
		Headers: map[string]string{
			"User-Agent":               "grok-shell/0.2.99 (linux; x86_64)",
			"x-grok-client-identifier": "grok-shell",
			"x-grok-client-version":    "0.2.99",
		},
	},
	"kimi": {
		ClientID: "17e5f671-d194-4dfb-9706-5516cb48c098",
		TokenURL: "https://auth.kimi.com/api/oauth/token", RefreshURL: "https://auth.kimi.com/api/oauth/token",
		BaseURL: "https://api.kimi.com/coding", AuthType: "claude",
		Headers: map[string]string{"User-Agent": "claude-cli/2.0.28 (external, cli)"},
	},
	"copilot": {
		ClientID: "Iv1.b507a08c87ecfe98", Scope: "read:user",
		TokenURL: "https://github.com/login/oauth/access_token",
		BaseURL:  "https://api.githubcopilot.com", AuthType: "openai",
		Headers: map[string]string{
			"User-Agent":            "GitHubCopilotChat/0.26.7",
			"Editor-Version":        "vscode/1.85.0",
			"Editor-Plugin-Version": "copilot-chat/0.26.7",
			"Openai-Intent":         "conversation-panel",
		},
	},
	"qoder":      {BaseURL: "https://api3.qoder.sh", AuthType: "openai"},
	"codebuddy":  {BaseURL: "https://www.codebuddy.ai/v2", AuthType: "openai",
		Headers: map[string]string{
			"User-Agent": "IDE/2.108.1 CodeBuddy/2.108.1", "X-Product": "SaaS",
			"X-IDE-Type": "IDE", "X-IDE-Name": "IDE",
			"x-requested-with": "XMLHttpRequest", "x-codebuddy-request": "1",
		}},
	"codebuddy-cn": {BaseURL: "https://copilot.tencent.com/v2", AuthType: "openai",
		Headers: map[string]string{
			"User-Agent": "CLI/2.108.1 CodeBuddy/2.108.1", "X-Product": "SaaS",
			"X-IDE-Type": "CLI", "X-IDE-Name": "CLI",
			"x-requested-with": "XMLHttpRequest", "x-codebuddy-request": "1",
		}},
	"cline":     {BaseURL: "https://api.cline.bot/api/v1", AuthType: "openai",
		Headers: map[string]string{"HTTP-Referer": "https://cline.bot", "X-Title": "Cline"}},
	"clinepass": {BaseURL: "https://api.cline.bot/api/v1", AuthType: "openai",
		Headers: map[string]string{"HTTP-Referer": "https://cline.bot", "X-Title": "Cline"}},
	"kilocode":  {BaseURL: "https://api.kilo.ai/api/openrouter", AuthType: "openai"},
}

// OAuthProviderID resolves a connection to its OAuth registry entry.
func OAuthProviderID(conn *db.ProviderConnection) (string, bool) {
	if conn == nil {
		return "", false
	}
	if v, ok := conn.Data["oauthProvider"].(string); ok && v != "" {
		return v, true
	}
	p := conn.Provider
	if strings.HasSuffix(p, "-oauth") {
		p = strings.TrimSuffix(p, "-oauth")
	}
	if _, ok := oauthDefs[p]; ok {
		return p, true
	}
	return "", false
}

func oauthDefFor(conn *db.ProviderConnection) (oauthDef, bool) {
	id, ok := OAuthProviderID(conn)
	if !ok {
		return oauthDef{}, false
	}
	d, ok := oauthDefs[id]
	return d, ok
}

// OAuthClientID returns the upstream client id for a refresh/token call.
func OAuthClientID(provID string, conn *db.ProviderConnection) string {
	if d, ok := oauthDefs[provID]; ok && d.ClientID != "" {
		return d.ClientID
	}
	if v, ok := conn.Data["clientId"].(string); ok {
		return v
	}
	return ""
}

// OAuthTokenURL returns the refresh/token endpoint for a provider.
func OAuthTokenURL(provID string, conn *db.ProviderConnection) string {
	if d, ok := oauthDefs[provID]; ok {
		if d.RefreshURL != "" {
			return d.RefreshURL
		}
		if d.TokenURL != "" {
			return d.TokenURL
		}
	}
	if v, ok := conn.Data["refreshUrl"].(string); ok && v != "" {
		return v
	}
	if v, ok := conn.Data["tokenUrl"].(string); ok {
		return v
	}
	return ""
}

// OAuthBaseURL returns the chat base URL for an OAuth connection ("" when
// the connection is not OAuth-backed).
func OAuthBaseURL(conn *db.ProviderConnection) string {
	if d, ok := oauthDefFor(conn); ok {
		return d.BaseURL
	}
	return ""
}

// OAuthModelAlias returns the forced upstream model id for an OAuth
// connection ("" when none), e.g. grok-cli always sends "grok-build".
func OAuthModelAlias(conn *db.ProviderConnection) string {
	if d, ok := oauthDefFor(conn); ok {
		return d.ModelAlias
	}
	return ""
}

// OAuthScope returns the configured scope string (may be empty).
func OAuthScope(provID string) string {
	if d, ok := oauthDefs[provID]; ok {
		return d.Scope
	}
	return ""
}

// OAuthHeaders are the per-provider request headers (User-Agent spoofing etc.).
func OAuthHeaders(conn *db.ProviderConnection) map[string]string {
	if d, ok := oauthDefFor(conn); ok {
		return d.Headers
	}
	return nil
}
