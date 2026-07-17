package gateway

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"myAiRouter/pkg/db"
	"myAiRouter/pkg/rtk"
)

func RegisterGatewayRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/chat/completions", handleChatCompletions)
	mux.HandleFunc("GET /v1/models", HandleListModels)
}

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

func getActiveConnectionsForPrefix(providerPrefix string) ([]db.ProviderConnection, error) {
	// 1. Try directly with the prefix as the provider name
	conns, err := db.GetActiveConnectionsForProvider(providerPrefix)
	if err == nil && len(conns) > 0 {
		return conns, nil
	}

	// 2. If not found, list all connections and check their modelPrefix
	allConns, err := db.ListConnections()
	if err != nil {
		return nil, err
	}

	for _, c := range allConns {
		if !c.IsActive {
			continue
		}
		prefix, _ := c.Data["modelPrefix"].(string)
		prefix = strings.TrimSuffix(prefix, "/")
		if prefix == providerPrefix {
			// Found matching provider connection! Return active connections for this provider
			return db.GetActiveConnectionsForProvider(c.Provider)
		}
	}

	return nil, nil
}

func handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	apiKey, authenticated := authenticateGatewayRequest(r)
	if !authenticated {
		WriteErrorResponse(w, http.StatusUnauthorized, "Invalid API key")
		return
	}

	// Read request body
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		WriteErrorResponse(w, http.StatusBadRequest, "Failed to read request body")
		return
	}

	var body map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &body); err != nil {
		WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	modelStr, _ := body["model"].(string)
	if modelStr == "" {
		WriteErrorResponse(w, http.StatusBadRequest, "Missing model parameter")
		return
	}

	// 1. Resolve fallback combo or single model
	var modelsToTry []string
	combo, err := db.GetComboByName(modelStr)
	if err == nil && combo != nil && len(combo.Models) > 0 {
		modelsToTry = combo.Models
	} else {
		modelsToTry = []string{modelStr}
	}

	// 2. Fallback execution loops
	var lastErr error
	var lastStatus int = http.StatusServiceUnavailable

	for _, currentModel := range modelsToTry {
		// Determine provider
		provider := "openai"
		modelName := currentModel
		if idx := strings.Index(currentModel, "/"); idx != -1 {
			provider = currentModel[:idx]
			modelName = currentModel[idx+1:]
		}

		// Retrieve active accounts
		accounts, err := getActiveConnectionsForPrefix(provider)
		if err != nil || len(accounts) == 0 {
			lastErr = fmt.Errorf("no active accounts for provider %s", provider)
			continue
		}

		// Run request across accounts
		for _, account := range accounts {
			// Update the body model parameter for upstream executor
			body["model"] = modelName

			// Load settings for token savers
			settings, _ := db.GetSettings()

			// In-place RTK compression (Bolt)
			if settings != nil {
				rtk.CompressMessages(body, settings.RtkEnabled)
			}

			// In-place prompt injectors (Caveman / Ponytail)
			format := provider
			if provider != "anthropic" && provider != "gemini" {
				format = "openai"
			}
			rtk.InjectSystemPrompts(body, format, settings)

			// Headroom compression check
			if settings != nil && settings.HeadroomEnabled && settings.HeadroomUrl != "" {
				if msgs, ok := body["messages"].([]interface{}); ok {
					compressed := rtk.CompressWithHeadroom(r.Context(), settings.HeadroomUrl, modelName, msgs)
					body["messages"] = compressed
				}
			}

			startTime := time.Now()
			// Execute request
			res := ExecuteProviderRequest(r.Context(), &account, body)
			if res.Err != nil {
				lastErr = res.Err
				lastStatus = http.StatusInternalServerError
				continue
			}

			if res.ResponseCode >= 400 {
				lastStatus = res.ResponseCode
				lastErr = fmt.Errorf("upstream provider error: status %d", res.ResponseCode)
				// 400 Bad Request usually means client mistake (e.g. invalid parameter), don't fallback
				if res.ResponseCode == http.StatusBadRequest {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(res.ResponseCode)
					_, _ = w.Write(res.Body)
					return
				}
				continue // Fallback to next account
			}

			// Request succeeded! Handle stream or JSON response
			promptTokens := 0
			completionTokens := 0
			cachedTokens := 0

			if res.IsStream {
				pTokens, cTokens, cat, err := HandleSSEStream(w, r, res.Stream, format)
				if err == nil {
					promptTokens = pTokens
					completionTokens = cTokens
					cachedTokens = cat
				}
			} else {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(res.ResponseCode)
				_, _ = w.Write(res.Body)

				var parsedResponse map[string]interface{}
				if err := json.Unmarshal(res.Body, &parsedResponse); err == nil {
					if usage, ok := parsedResponse["usage"].(map[string]interface{}); ok {
						if pVal, ok := usage["prompt_tokens"].(float64); ok {
							promptTokens = int(pVal)
						}
						if cVal, ok := usage["completion_tokens"].(float64); ok {
							completionTokens = int(cVal)
						}
						for _, key := range []string{"cache_creation_input_tokens", "cache_read_input_tokens", "cached_tokens"} {
							if v, ok := usage[key].(float64); ok {
								cachedTokens += int(v)
							}
						}
						if details, ok := usage["prompt_tokens_details"].(map[string]interface{}); ok {
							for _, key := range []string{"cache_creation_input_tokens", "cache_read_input_tokens", "cached_tokens"} {
								if v, ok := details[key].(float64); ok {
									cachedTokens += int(v)
								}
							}
						}
					}
				}
			}

			duration := time.Since(startTime)
			metaJSON, _ := json.Marshal(map[string]interface{}{
				"duration_ms": duration.Milliseconds(),
			})

			// Save usage tracking
			_ = db.SaveRequestUsage(&db.UsageEntry{
				Provider:         provider,
				Model:            modelName,
				ConnectionID:     account.ID,
				APIKey:           apiKey,
				Endpoint:         "/v1/chat/completions",
				PromptTokens:     promptTokens,
				CompletionTokens: completionTokens,
				CachedTokens:     cachedTokens,
				Status:           "ok",
				Tokens: db.TokenUsage{
					PromptTokens:     promptTokens,
					CompletionTokens: completionTokens,
					CachedTokens:     cachedTokens,
				},
				Meta:             string(metaJSON),
			})

			return // Request completed successfully
		}
	}

	// If we exhausted all combos and accounts without success
	errMsg := "All provider accounts and fallbacks exhausted"
	if lastErr != nil {
		errMsg = fmt.Sprintf("%s: %v", errMsg, lastErr)
	}
	WriteErrorResponse(w, lastStatus, errMsg)
}

func HandleListModels(w http.ResponseWriter, r *http.Request) {
	_, authenticated := authenticateGatewayRequest(r)
	if !authenticated {
		WriteErrorResponse(w, http.StatusUnauthorized, "Invalid API key")
		return
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
		"openai":     {"gpt-4o", "gpt-4o-mini", "o1", "o1-mini"},
		"anthropic":  {"claude-3-5-sonnet-20241022", "claude-haiku-4.5"},
		"gemini":     {"gemini-2.5-flash", "gemini-2.5-pro"},
		"deepseek":   {"deepseek-chat", "deepseek-reasoner"},
		"kilocode":   {"gpt-4o", "claude-sonnet-4-20250514", "gemini-2.5-pro", "deepseek-chat"},
		"glm":        {"glm-5.2", "glm-5.1", "glm-5", "glm-4.7", "glm-4.6v", "glm-4.6", "glm-4.5-flash"},
		"glm-coding": {"glm-5.2", "glm-5.1", "glm-5", "glm-4.7", "glm-4.6v", "glm-4.6", "glm-4.5-flash"},
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
