package gateway

// Declarative OAuth provider registry, extracted from the 9router bundle so
// myairouter speaks the exact same flows (same client IDs, endpoints, scopes).
//
// Three auth shapes are covered:
//   - oauthDevice: standard RFC 8628 device-code grant (xAI, Kimi, GitHub Copilot)
//   - qoder:       job-token exchange via openapi.qoder.sh
//   - codebuddy:   state-URL QR flow via copilot.tencent.com / codebuddy.ai
//
// PKCE providers (Claude Code, Codex, Antigravity, Cursor) need a localhost
// callback listener — batch 2.

import "time"

// OAuthProvider describes one provider's OAuth login + chat transport.
type OAuthProvider struct {
	ID   string `json:"id"`
	Name string `json:"name"`

	// Transport
	AuthType   string            `json:"authType"` // openai | claude | responses
	BaseURL    string            `json:"baseUrl"`
	ChatPath   string            `json:"chatPath,omitempty"`
	Headers    map[string]string `json:"headers,omitempty"`
	ModelAlias string            `json:"modelAlias,omitempty"` // force one upstream model id

	// Device flow (RFC 8628)
	ClientID      string `json:"clientId,omitempty"`
	DeviceCodeURL string `json:"deviceCodeUrl,omitempty"`
	TokenURL      string `json:"tokenUrl,omitempty"`
	RefreshURL    string `json:"refreshUrl,omitempty"`
	Scope         string `json:"scope,omitempty"`
	DeviceAuthURL string `json:"deviceAuthURL,omitempty"` // page the user opens (defaults to DeviceCodeURL)

	// Non-standard flows
	Flow          string `json:"flow,omitempty"` // "" = device | "qoder" | "codebuddy"
	StateURL      string `json:"stateUrl,omitempty"`
	PollURL       string `json:"pollUrl,omitempty"`   // qoder deviceToken/poll
	LoginURL      string `json:"loginUrl,omitempty"`  // page for qoder/codebuddy
	RefreshVia    string `json:"refreshVia,omitempty"`
	ExtraHeaders  map[string]string `json:"extraHeaders,omitempty"`
	PollIntervalS int                `json:"pollIntervalS,omitempty"`

	// Copilot two-step: GitHub OAuth token -> short-lived copilot token
	CopilotTokenURL string `json:"copilotTokenUrl,omitempty"`
}

// OAuthProviders is the batch-1 (device / no-callback) registry.
var OAuthProviders = map[string]OAuthProvider{
	"xai": {
		ID: "xai", Name: "xAI (Grok)",
		AuthType: "openai",
		BaseURL:  "https://api.x.ai/v1",
		ClientID: "b1a00492-073a-47ea-816f-4c329264a828",
		DeviceCodeURL: "https://auth.x.ai/oauth2/device/code",
		TokenURL:      "https://auth.x.ai/oauth2/token",
		RefreshURL:    "https://auth.x.ai/oauth2/token",
		Scope:         "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write",
	},
	"grok-cli": {
		ID: "grok-cli", Name: "Grok CLI (Grok Build)",
		AuthType:   "responses",
		BaseURL:    "https://cli-chat-proxy.grok.com/v1",
		ModelAlias: "grok-build",
		Headers: map[string]string{
			"User-Agent":                 "grok-shell/0.2.99 (linux; x86_64)",
			"x-grok-client-identifier":   "grok-shell",
			"x-grok-client-version":      "0.2.99",
		},
		ClientID:      "b1a00492-073a-47ea-816f-4c329264a828",
		DeviceCodeURL: "https://auth.x.ai/oauth2/device/code",
		TokenURL:      "https://auth.x.ai/oauth2/token",
		RefreshURL:    "https://auth.x.ai/oauth2/token",
		Scope:         "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write",
	},
	"kimi": {
		ID: "kimi", Name: "Kimi (Coding)",
		AuthType: "claude", // primary transport is /v1/messages claude-format
		BaseURL:  "https://api.kimi.com/coding",
		Headers: map[string]string{
			"User-Agent": "claude-cli/2.0.28 (external, cli)",
			"Accept":     "application/json",
		},
		ClientID:      "17e5f671-d194-4dfb-9706-5516cb48c098",
		DeviceCodeURL: "https://auth.kimi.com/api/oauth/device_authorization",
		DeviceAuthURL: "https://www.kimi.com/code/authorize_device",
		TokenURL:      "https://auth.kimi.com/api/oauth/token",
		RefreshURL:    "https://auth.kimi.com/api/oauth/token",
	},
	"copilot": {
		ID: "copilot", Name: "GitHub Copilot",
		AuthType: "openai",
		BaseURL:  "https://api.githubcopilot.com",
		Headers: map[string]string{
			"User-Agent":         "GitHubCopilotChat/0.26.7",
			"Editor-Version":     "vscode/1.85.0",
			"Editor-Plugin-Version": "copilot-chat/0.26.7",
			"Openai-Intent":      "conversation-panel",
		},
		ClientID:        "Iv1.b507a08c87ecfe98",
		DeviceCodeURL:   "https://github.com/login/device/code",
		TokenURL:        "https://github.com/login/oauth/access_token",
		Scope:           "read:user",
		CopilotTokenURL: "https://api.github.com/copilot_internal/v2/token",
	},
	"qoder": {
		ID: "qoder", Name: "Qoder",
		AuthType: "openai",
		BaseURL:  "https://api3.qoder.sh",
		Flow:     "qoder",
		PollURL:  "https://openapi.qoder.sh/api/v1/deviceToken/poll",
		LoginURL: "https://qoder.com/device/selectAccounts",
		RefreshVia: "https://center.qoder.sh/algo/api/v3/user/refresh_token",
	},
	"codebuddy": {
		ID: "codebuddy", Name: "CodeBuddy",
		AuthType: "openai",
		BaseURL:  "https://www.codebuddy.ai/v2",
		Flow:     "codebuddy",
		StateURL: "https://www.codebuddy.ai/v2/plugin/auth/state",
		TokenURL: "https://www.codebuddy.ai/v2/plugin/auth/token",
		RefreshURL: "https://www.codebuddy.ai/v2/plugin/auth/token/refresh",
		Headers: map[string]string{
			"User-Agent":            "IDE/2.108.1 CodeBuddy/2.108.1",
			"X-Product":             "SaaS",
			"X-IDE-Type":            "IDE",
			"X-IDE-Name":            "IDE",
			"x-requested-with":      "XMLHttpRequest",
			"x-codebuddy-request":   "1",
		},
		PollIntervalS: 5,
	},
	"codebuddy-cn": {
		ID: "codebuddy-cn", Name: "CodeBuddy CN",
		AuthType: "openai",
		BaseURL:  "https://copilot.tencent.com/v2",
		Flow:     "codebuddy",
		StateURL: "https://copilot.tencent.com/v2/plugin/auth/state",
		TokenURL: "https://copilot.tencent.com/v2/plugin/auth/token",
		RefreshURL: "https://copilot.tencent.com/v2/plugin/auth/token/refresh",
		Headers: map[string]string{
			"User-Agent":          "CLI/2.108.1 CodeBuddy/2.108.1",
			"X-Product":           "SaaS",
			"X-IDE-Type":          "CLI",
			"X-IDE-Name":          "CLI",
			"x-requested-with":    "XMLHttpRequest",
			"x-codebuddy-request": "1",
		},
		PollIntervalS: 5,
	},
	"cline": {
		ID: "cline", Name: "Cline",
		AuthType: "openai",
		BaseURL:  "https://api.cline.bot/api/v1",
		Headers: map[string]string{
			"HTTP-Referer": "https://cline.bot",
			"X-Title":      "Cline",
		},
		TokenURL:   "https://api.cline.bot/api/v1/auth/token",
		RefreshURL: "https://api.cline.bot/api/v1/auth/refresh",
		Flow:       "cline",
		LoginURL:   "https://app.cline.bot",
	},
	"clinepass": {
		ID: "clinepass", Name: "ClinePass",
		AuthType: "openai",
		BaseURL:  "https://api.cline.bot/api/v1",
		Headers: map[string]string{
			"HTTP-Referer": "https://cline.bot",
			"X-Title":      "Cline",
		},
		TokenURL:   "https://api.cline.bot/api/v1/auth/token",
		RefreshURL: "https://api.cline.bot/api/v1/auth/refresh",
		Flow:       "cline",
		LoginURL:   "https://app.cline.bot",
	},
	"kilocode": {
		ID: "kilocode", Name: "Kilo Code",
		AuthType: "openai",
		BaseURL:  "https://api.kilo.ai/api/openrouter",
		// device flow handled by the existing kilocode initiate/poll handlers
		Flow: "kilocode",
	},
}

// oauthProviderFor maps a connection provider id to its OAuth descriptor.
// Also accepts the connection ids minted at login ("xai-oauth" etc.).
func oauthProviderFor(provider string) (*OAuthProvider, bool) {
	if p, ok := OAuthProviders[provider]; ok {
		return &p, true
	}
	if len(provider) > 6 && provider[len(provider)-6:] == "-oauth" {
		base := provider[:len(provider)-6]
		if p, ok := OAuthProviders[base]; ok {
			return &p, true
		}
	}
	return nil, false
}

// oauthTokenExpiry is a rough bound used when upstream sends no expires_in.
const oauthTokenExpiry = 3600 * time.Second
