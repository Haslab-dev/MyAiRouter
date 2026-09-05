package gateway

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"myAiRouter/pkg/db"
)

func authenticateGatewayRequest(r *http.Request) (string, bool) {
	settings, err := db.GetSettings()
	if err != nil || !settings.RequireLogin {
		return "guest", true
	}

	// Allow admin session cookie (admin UI calls gateway endpoints without Bearer token)
	if cookie, err := r.Cookie("session"); err == nil {
		sessionsMu.RLock()
		expiry, ok := sessions[cookie.Value]
		sessionsMu.RUnlock()
		if ok && time.Now().Before(expiry) {
			return "admin", true
		}
	}

	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return "", false
	}
	key := strings.TrimPrefix(authHeader, "Bearer ")

	valid, err := db.ValidateApiKey(key)
	if err != nil || !valid {
		return "", false
	}

	return key, true
}

func HandleListModels(w http.ResponseWriter, r *http.Request) {
	_, authenticated := authenticateGatewayRequest(r)
	if !authenticated {
		origin := r.Header.Get("Origin")
		referer := r.Header.Get("Referer")
		isLocalUI := strings.Contains(origin, "localhost") || strings.Contains(referer, "localhost") ||
			strings.Contains(origin, "127.0.0.1") || strings.Contains(referer, "127.0.0.1") ||
			strings.HasPrefix(r.URL.Path, "/api/")
		if !isLocalUI {
			WriteErrorResponse(w, http.StatusUnauthorized, "Invalid API key")
			return
		}
	}

	conns, err := db.ListConnections()
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "Failed to load providers")
		return
	}

	type modelEntry struct {
		ID      string `json:"id"`
		Object  string `json:"object"`
		OwnedBy string `json:"owned_by"`
		Created int64  `json:"created"`
	}

	var data = make([]modelEntry, 0)

	// Default model catalogs per provider
	defaultModels := map[string][]string{
		"openai":        {"gpt-4o", "gpt-4o-mini", "o1", "o1-mini"},
		"anthropic":     {"claude-3-5-sonnet-20241022", "claude-haiku-4.5"},
		"gemini":        {"gemini-2.5-flash", "gemini-2.5-pro"},
		"deepseek":      {"deepseek-chat", "deepseek-reasoner"},
		"kilocode":      {"gpt-4o", "claude-sonnet-4-20250514", "gemini-2.5-pro", "deepseek-chat"},
		"glm":           {"glm-5.2", "glm-5.1", "glm-5", "glm-4.7", "glm-4.6v", "glm-4.6", "glm-4.5-flash"},
		"glm-coding":    {"glm-5.2", "glm-5.1", "glm-5", "glm-4.7", "glm-4.6v", "glm-4.6", "glm-4.5-flash"},
		"nvidia":        {"meta/llama-3.3-70b-instruct", "deepseek-ai/deepseek-r1", "nvidia/llama-3.1-nemotron-70b-instruct"},
		"groq":          {"llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "deepseek-r1-distill-llama-70b"},
		"openrouter":    {"auto", "anthropic/claude-3.5-sonnet", "openai/gpt-4o", "deepseek/deepseek-r1"},
		"mistral":       {"mistral-large-latest", "mistral-small-latest", "codestral-latest", "pixtral-large-latest", "open-mistral-nemo"},
		"meta":          {"llama-3.3-70b-instruct", "llama-3.1-405b-instruct", "llama-3.1-70b-instruct", "llama-3.1-8b-instruct"},
		"kenari":        {"kenari-default"},
		"sumopod":       {"deepseek-r1", "deepseek-v3", "qwen-2.5-72b-instruct"},
		"ollama":        {"llama3.3", "qwen2.5-coder", "deepseek-r1"},
		"qwen":          {"qwen-max", "qwen-plus", "qwen-turbo", "qwen-coder-plus"},
		"tencent":       {"hunyuan-pro", "hunyuan-standard", "hunyuan-lite"},
		"vercel":        {"openai/gpt-4o", "anthropic/claude-3-5-sonnet"},
		"fireworks":     {"accounts/fireworks/models/deepseek-r1", "accounts/fireworks/models/llama-v3p3-70b-instruct"},
		"cloudflare-ai": {"@cf/meta/llama-3.3-70b-instruct", "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"},
		"cerebras":      {"llama-3.3-70b", "llama-3.1-8b", "qwen-2.5-32b", "deepseek-r1-distill-llama-70b"},
	}

	seenProviders := make(map[string]bool)
	for _, c := range conns {
		if !c.IsActive {
			continue
		}
		seenProviders[c.Provider] = true
	}

	for provider, models := range defaultModels {
		if !seenProviders[provider] {
			continue
		}

		// Whitelist: if enabled models set, only those pass
		enabled, _ := db.GetEnabledModels(provider)
		enabledSet := make(map[string]bool)
		hasWhitelist := enabled != nil
		for _, e := range enabled {
			enabledSet[e] = true
		}

		// Apply custom modelPrefix from connection data if set
		prefix := provider + "/"
		prefConn, _ := db.GetActiveConnectionsForProvider(provider)
		if len(prefConn) > 0 {
			if p, ok := prefConn[0].Data["modelPrefix"].(string); ok && p != "" {
				prefix = p
			}
		}

		for _, model := range models {
			if hasWhitelist && !enabledSet[model] {
				continue
			}
			displayID := prefix + model
			if !strings.Contains(prefix, "/") {
				displayID = prefix + "/" + model
			}
			data = append(data, modelEntry{
				ID:      displayID,
				Object:  "model",
				OwnedBy: provider,
				Created: 1735000000,
			})
		}

		// Include custom models (whitelist-filtered)
		customs, _ := db.GetCustomModelsByProvider(provider)
		for _, cm := range customs {
			if hasWhitelist && !enabledSet[cm.ID] {
				continue
			}
			displayID := prefix + cm.ID
			if !strings.Contains(prefix, "/") {
				displayID = prefix + "/" + cm.ID
			}
			data = append(data, modelEntry{
				ID:      displayID,
				Object:  "model",
				OwnedBy: provider,
				Created: 1735000000,
			})
		}
	}

	// Add custom provider models (providers NOT in defaultModels — e.g. openai-compatible-*)
	allCustom, _ := db.GetCustomModels()
	for _, cm := range allCustom {
		if _, has := seenProviders[cm.ProviderAlias]; !has {
			continue
		}
		if _, inDefault := defaultModels[cm.ProviderAlias]; inDefault {
			continue // already handled by default loop above
		}

		// Whitelist check
		enabled, _ := db.GetEnabledModels(cm.ProviderAlias)
		if enabled != nil {
			enabledSet := make(map[string]bool)
			for _, e := range enabled {
				enabledSet[e] = true
			}
			if !enabledSet[cm.ID] {
				continue
			}
		}

		prefix := cm.ProviderAlias + "/"
		for _, c := range conns {
			if c.Provider == cm.ProviderAlias && c.IsActive {
				if p, ok := c.Data["modelPrefix"].(string); ok && p != "" {
					prefix = p
				}
				break
			}
		}
		displayID := prefix + cm.ID
		if !strings.Contains(prefix, "/") {
			displayID = prefix + "/" + cm.ID
		}
		data = append(data, modelEntry{
			ID:      displayID,
			Object:  "model",
			OwnedBy: cm.ProviderAlias,
			Created: 1735000000,
		})
	}

	// Add combos
	combos, _ := db.ListCombos()
	for _, combo := range combos {
		data = append(data, modelEntry{
			ID:      combo.Name,
			Object:  "model",
			OwnedBy: "combo",
			Created: 1735000000,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"object": "list",
		"data":   data,
	})
}
