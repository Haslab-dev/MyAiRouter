package gateway

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"myAiRouter/pkg/db"
	"myAiRouter/pkg/logger"
)

// In-memory session store (UUID → expiry)
var (
	sessions   = map[string]time.Time{}
	sessionsMu sync.RWMutex
)

func hashPassword(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

const defaultPasswordHash = "6e5a9c8ce6e5a9c8ce6e5a9c8ce6e5a9c8ce6e5a9c8ce6e5a9c8ce6e5a9c8ce" // placeholder, computed below

func getDefaultHash() string {
	return hashPassword("123456789")
}

func issueSession() string {
	b := make([]byte, 16)
	for i := range b {
		b[i] = byte(i + 1)
	}
	sum := sha256.Sum256(append(b, []byte(time.Now().String())...))
	return hex.EncodeToString(sum[:])
}

func validateSession(r *http.Request) bool {
	// Check if auth is required at all
	settings, err := db.GetSettings()
	if err != nil || !settings.RequireLogin {
		return true
	}
	cookie, err := r.Cookie("session")
	if err != nil {
		return false
	}
	sessionsMu.RLock()
	expiry, ok := sessions[cookie.Value]
	sessionsMu.RUnlock()
	return ok && time.Now().Before(expiry)
}

func RegisterAdminRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/settings", handleSettings)
	mux.HandleFunc("/api/providers", handleProviders)
	mux.HandleFunc("/api/providers/", handleProviderDetail) // Matches /api/providers/<id>
	mux.HandleFunc("/api/provider-nodes", handleProviderNodes)
	mux.HandleFunc("/api/provider-nodes/", handleProviderNodeDetail) // Matches /api/provider-nodes/<id>
	mux.HandleFunc("/api/oauth/kilocode/initiate", handleKilocodeInitiate)
	mux.HandleFunc("/api/oauth/kilocode/poll", handleKilocodePoll)
	mux.HandleFunc("/api/keys", handleKeys)
	mux.HandleFunc("/api/combos", handleCombos)
	mux.HandleFunc("/api/usage/stats", handleUsageStats)
	mux.HandleFunc("/api/usage/logs", handleUsageLogs)
	mux.HandleFunc("/api/usage/charts", handleUsageCharts)
	mux.HandleFunc("/api/usage/models", handleUsageModels)
	mux.HandleFunc("/api/models/disabled", handleModelsDisabled)
	mux.HandleFunc("/api/models/enabled", handleModelsEnabled)
	mux.HandleFunc("/api/models/custom", handleModelsCustom)
	mux.HandleFunc("/api/logs", handleServerLogs)
	mux.HandleFunc("/api/health", handleHealth)
	mux.HandleFunc("/api/traces", handleTraces)
	mux.HandleFunc("/api/traces/", handleTraceDetail)
	// Auth
	mux.HandleFunc("/api/auth/status", handleAuthStatus)
	mux.HandleFunc("/api/auth/login", handleAuthLogin)
	mux.HandleFunc("/api/auth/logout", handleAuthLogout)
	mux.HandleFunc("/api/auth/change-password", handleAuthChangePassword)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func handleSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodGet {
		settings, err := db.GetSettings()
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(settings)
		return
	}

	if r.Method == http.MethodPatch || r.Method == http.MethodPut {
		var updates map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}

		settings, err := db.UpdateSettings(updates)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(settings)
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func handleProviders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodGet {
		conns, err := db.ListConnections()
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(conns)
		return
	}

	if r.Method == http.MethodPost {
		var conn db.ProviderConnection
		if err := json.NewDecoder(r.Body).Decode(&conn); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}

		created, err := db.CreateConnection(&conn)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(created)
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func handleProviderDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// URL format: /api/providers/<id> or /api/providers/<id>/test
	path := strings.TrimPrefix(r.URL.Path, "/api/providers/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		WriteErrorResponse(w, http.StatusBadRequest, "Missing provider connection ID")
		return
	}
	id := parts[0]

	if len(parts) > 1 && parts[1] == "test" {
		if r.Method == http.MethodPost {
			handleTestProvider(w, r, id)
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	if len(parts) > 1 && parts[1] == "models" {
		if r.Method == http.MethodGet {
			handleImportProviderModels(w, r, id)
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	if r.Method == http.MethodGet {
		conn, err := db.GetConnection(id)
		if err != nil {
			WriteErrorResponse(w, http.StatusNotFound, "Connection not found")
			return
		}
		_ = json.NewEncoder(w).Encode(conn)
		return
	}

	if r.Method == http.MethodPatch || r.Method == http.MethodPut {
		var updates map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}

		updated, err := db.UpdateConnection(id, updates)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(updated)
		return
	}

	if r.Method == http.MethodDelete {
		if err := db.DeleteConnection(id); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func handleTestProvider(w http.ResponseWriter, r *http.Request, id string) {
	conn, err := db.GetConnection(id)
	if err != nil {
		WriteErrorResponse(w, http.StatusNotFound, "Connection not found")
		return
	}

	// Prepare simple model test payload
	testModel := "gpt-4o-mini"
	if conn.Provider == "anthropic" {
		testModel = "claude-3-haiku-20240307"
	} else if conn.Provider == "gemini" {
		testModel = "gemini-2.5-flash"
	}

	testPayload := map[string]interface{}{
		"model":      testModel,
		"max_tokens": 1,
		"messages": []interface{}{
			map[string]interface{}{
				"role":    "user",
				"content": "ping",
			},
		},
	}

	res := ExecuteProviderRequest(r.Context(), conn, testPayload)

	valid := false
	var errMsg string

	if res.Err != nil {
		errMsg = res.Err.Error()
	} else {
		// HTTP 401/403/404 are invalid credentials/endpoints
		valid = res.ResponseCode != http.StatusUnauthorized && res.ResponseCode != http.StatusForbidden && res.ResponseCode != http.StatusNotFound
		if !valid {
			errMsg = "Invalid API key or endpoint URL (HTTP " + strconv.Itoa(res.ResponseCode) + ")"
		}
	}

	statusStr := "error"
	if valid {
		statusStr = "active"
	}

	// Update DB test status
	updates := map[string]interface{}{
		"data": map[string]interface{}{
			"testStatus": statusStr,
			"lastError":  errMsg,
		},
	}
	_, _ = db.UpdateConnection(id, updates)

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"valid": valid,
		"error": errMsg,
	})
}

func handleKeys(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodGet {
		keys, err := db.ListApiKeys()
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(keys)
		return
	}

	if r.Method == http.MethodPost {
		var payload struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}

		key, err := db.CreateApiKey(payload.Name)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(key)
		return
	}

	if r.Method == http.MethodDelete {
		id := r.URL.Query().Get("id")
		if id == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "Missing id parameter")
			return
		}

		if err := db.DeleteApiKey(id); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func handleCombos(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodGet {
		list, err := db.ListCombos()
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(list)
		return
	}

	if r.Method == http.MethodPost {
		var combo db.Combo
		if err := json.NewDecoder(r.Body).Decode(&combo); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}

		created, err := db.CreateCombo(&combo)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(created)
		return
	}

	if r.Method == http.MethodDelete {
		id := r.URL.Query().Get("id")
		if id == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "Missing id parameter")
			return
		}

		if err := db.DeleteCombo(id); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func handleUsageStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	stats, err := db.GetUsageStats()
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = json.NewEncoder(w).Encode(stats)
}

func handleUsageLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	limitStr := r.URL.Query().Get("limit")
	limit := 50
	if limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil {
			limit = parsed
		}
	}

	logs, err := db.GetRecentLogs(limit)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = json.NewEncoder(w).Encode(logs)
}

func handleUsageCharts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	type ChartPoint struct {
		Label  string  `json:"label"`
		Tokens int     `json:"tokens"`
		Cost   float64 `json:"cost"`
	}

	points := make([]ChartPoint, 24)
	for i := 0; i < 24; i++ {
		points[i] = ChartPoint{
			Label:  fmt.Sprintf("%02d:00", i),
			Tokens: 0,
			Cost:   0,
		}
	}

	// Group by hour for today (local time is UTC+7, but let's query all requests in the last 24 hours to keep it robust)
	rows, err := db.DB.Query(`
		SELECT 
			STRFTIME('%H', timestamp) as hour_part,
			SUM(promptTokens + completionTokens) as total_tokens,
			SUM(cost) as total_cost
		FROM usageHistory
		WHERE timestamp >= datetime('now', '-24 hours')
		GROUP BY hour_part
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var hourStr string
			var tokens int
			var cost float64
			if err := rows.Scan(&hourStr, &tokens, &cost); err == nil {
				var h int
				if parsed, err := strconv.Atoi(hourStr); err == nil {
					h = parsed
				}
				if h >= 0 && h < 24 {
					points[h].Tokens = tokens
					points[h].Cost = math.Round(cost*10000) / 10000
				}
			}
		}
	}

	_ = json.NewEncoder(w).Encode(points)
}

func handleProviderNodes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodGet {
		nodes, err := db.ListProviderNodes()
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"nodes": nodes})
		return
	}

	if r.Method == http.MethodPost {
		var node db.ProviderNode
		if err := json.NewDecoder(r.Body).Decode(&node); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}

		created, err := db.CreateProviderNode(&node)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(created)
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func handleProviderNodeDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	path := strings.TrimPrefix(r.URL.Path, "/api/provider-nodes/")
	id := strings.Split(path, "/")[0]
	if id == "" {
		WriteErrorResponse(w, http.StatusBadRequest, "Missing node ID")
		return
	}

	if r.Method == http.MethodDelete {
		if err := db.DeleteProviderNode(id); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func handleKilocodeInitiate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	resp, err := http.Post("https://api.kilo.ai/api/device-auth/codes", "application/json", nil)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "Failed to initiate Kilo Code auth: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		WriteErrorResponse(w, resp.StatusCode, "Failed to initiate auth from Kilo Code API")
		return
	}

	var data struct {
		Code            string `json:"code"`
		VerificationUrl string `json:"verificationUrl"`
		ExpiresIn       int    `json:"expiresIn"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "Decoding Kilo Code response: "+err.Error())
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"device_code":      data.Code,
		"user_code":        data.Code,
		"verification_uri": data.VerificationUrl,
		"expires_in":       data.ExpiresIn,
	})
}

func handleKilocodePoll(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var payload struct {
		DeviceCode string `json:"device_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	resp, err := http.Get("https://api.kilo.ai/api/device-auth/codes/" + payload.DeviceCode)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "Polling failed: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == 202 {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "authorization_pending"})
		return
	}

	if resp.StatusCode != http.StatusOK {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "error", "error": "Access denied or expired"})
		return
	}

	var data struct {
		Status    string `json:"status"`
		Token     string `json:"token"`
		UserEmail string `json:"userEmail"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "Decoding poll response: "+err.Error())
		return
	}

	if data.Status == "approved" && data.Token != "" {
		orgId := ""
		client := &http.Client{Timeout: 5 * time.Second}
		req, err := http.NewRequest("GET", "https://api.kilo.ai/api/profile", nil)
		if err == nil {
			req.Header.Set("Authorization", "Bearer "+data.Token)
			profileResp, err := client.Do(req)
			if err == nil {
				defer profileResp.Body.Close()
				if profileResp.StatusCode == http.StatusOK {
					var profile struct {
						Organizations []struct {
							ID string `json:"id"`
						} `json:"organizations"`
					}
					if err := json.NewDecoder(profileResp.Body).Decode(&profile); err == nil && len(profile.Organizations) > 0 {
						orgId = profile.Organizations[0].ID
					}
				}
			}
		}

		now := time.Now().UTC().Format(time.RFC3339)
		conn := &db.ProviderConnection{
			ID:        "kilocode-oauth",
			Provider:  "kilocode",
			AuthType:  "oauth",
			Name:      "Kilo Code (" + data.UserEmail + ")",
			Email:     data.UserEmail,
			Priority:  1,
			IsActive:  true,
			CreatedAt: now,
			UpdatedAt: now,
			Data: map[string]interface{}{
				"apiKey":  data.Token,
				"orgId":   orgId,
				"baseUrl": "https://api.kilo.ai/api/openrouter",
			},
		}

		_, err = db.CreateConnection(conn)
		if err != nil {
			_, _ = db.UpdateConnection("kilocode-oauth", map[string]interface{}{
				"name":      conn.Name,
				"email":     conn.Email,
				"updatedAt": now,
				"data":      conn.Data,
			})
		}

		_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "email": data.UserEmail})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "authorization_pending"})
}

func handleServerLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"logs": logger.GetLogs()})
}

func handleUsageModels(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	summaries, err := db.GetModelUsageSummary()
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = json.NewEncoder(w).Encode(summaries)
}

func handleModelsDisabled(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodGet {
		providerAlias := r.URL.Query().Get("providerAlias")
		if providerAlias == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "providerAlias required")
			return
		}
		ids, err := db.GetDisabledModels(providerAlias)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ids": ids})
		return
	}

	if r.Method == http.MethodPost {
		var payload struct {
			ProviderAlias string   `json:"providerAlias"`
			Ids           []string `json:"ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}
		if payload.ProviderAlias == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "providerAlias required")
			return
		}
		if err := db.DisableModels(payload.ProviderAlias, payload.Ids); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}

	if r.Method == http.MethodDelete {
		providerAlias := r.URL.Query().Get("providerAlias")
		id := r.URL.Query().Get("id")
		if providerAlias == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "providerAlias required")
			return
		}
		var ids []string
		if id != "" {
			ids = []string{id}
		}
		if err := db.EnableModels(providerAlias, ids); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func handleModelsEnabled(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var providerAlias string
	if r.Method == http.MethodPost || r.Method == http.MethodPut {
		var payload struct {
			ProviderAlias string   `json:"providerAlias"`
			Ids           []string `json:"ids"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}
		providerAlias = payload.ProviderAlias
		if providerAlias == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "providerAlias required")
			return
		}
		if err := db.SetEnabledModels(providerAlias, payload.Ids); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}

	providerAlias = r.URL.Query().Get("providerAlias")
	if r.Method == http.MethodGet {
		if providerAlias == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "providerAlias required")
			return
		}
		ids, err := db.GetEnabledModels(providerAlias)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ids": ids})
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func handleModelsCustom(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodGet {
		models, err := db.GetCustomModels()
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"models": models})
		return
	}

	if r.Method == http.MethodPost {
		var cm db.CustomModel
		if err := json.NewDecoder(r.Body).Decode(&cm); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}
		if cm.ProviderAlias == "" || cm.ID == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "providerAlias and id required")
			return
		}
		if cm.Type == "" {
			cm.Type = "llm"
		}
		if cm.Name == "" {
			cm.Name = cm.ID
		}
		added, err := db.AddCustomModel(&cm)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "added": added})
		return
	}

	if r.Method == http.MethodDelete {
		providerAlias := r.URL.Query().Get("providerAlias")
		id := r.URL.Query().Get("id")
		modelType := r.URL.Query().Get("type")
		if modelType == "" {
			modelType = "llm"
		}
		if providerAlias == "" || id == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "providerAlias and id required")
			return
		}
		if err := db.DeleteCustomModel(providerAlias, id, modelType); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func handleImportProviderModels(w http.ResponseWriter, r *http.Request, connectionId string) {
	w.Header().Set("Content-Type", "application/json")

	conn, err := db.GetConnection(connectionId)
	if err != nil {
		WriteErrorResponse(w, http.StatusNotFound, "Connection not found")
		return
	}

	apiKey, _ := conn.Data["apiKey"].(string)
	baseUrl, _ := conn.Data["baseUrl"].(string)

	if baseUrl == "" {
		WriteErrorResponse(w, http.StatusBadRequest, "No base URL configured for this provider connection")
		return
	}

	// Fetch models from provider
	url := fmt.Sprintf("%s/models", strings.TrimSuffix(baseUrl, "/"))
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "Creating models fetch request: "+err.Error())
		return
	}

	req.Header.Set("Content-Type", "application/json")
	if strings.Contains(conn.Provider, "anthropic") {
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	} else {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := client.Do(req)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "Requesting upstream models: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		WriteErrorResponse(w, resp.StatusCode, "Upstream models request failed")
		return
	}

	var upstreamResp struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Models []struct {
			ID string `json:"id"`
		} `json:"models"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&upstreamResp); err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "Decoding upstream models: "+err.Error())
		return
	}

	// Gather list
	var modelIds []string
	for _, m := range upstreamResp.Data {
		if m.ID != "" {
			modelIds = append(modelIds, m.ID)
		}
	}
	for _, m := range upstreamResp.Models {
		if m.ID != "" {
			modelIds = append(modelIds, m.ID)
		}
	}

	// Remove duplicates
	uniqueMap := make(map[string]bool)
	var finalModels []map[string]string
	for _, id := range modelIds {
		if !uniqueMap[id] {
			uniqueMap[id] = true
			finalModels = append(finalModels, map[string]string{
				"id":   id,
				"name": id,
			})
		}
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"provider":     conn.Provider,
		"connectionId": conn.ID,
		"models":       finalModels,
	})
}

func handleTraces(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 100
	if limitStr != "" {
		if val, err := strconv.Atoi(limitStr); err == nil {
			limit = val
		}
	}

	traces, err := db.GetRecentTraces(limit)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = json.NewEncoder(w).Encode(traces)
}

func handleTraceDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/traces/")
	id := strings.Split(path, "/")[0]
	if id == "" {
		WriteErrorResponse(w, http.StatusBadRequest, "Missing trace ID")
		return
	}

	trace, err := db.GetTraceByID(id)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	if trace == nil {
		WriteErrorResponse(w, http.StatusNotFound, "Trace not found")
		return
	}

	var parsed map[string]interface{}
	_ = json.Unmarshal([]byte(trace.Data), &parsed)

	_ = json.NewEncoder(w).Encode(parsed)
}


// ──────────────────── Auth handlers ────────────────────

func handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	settings, err := db.GetSettings()
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	authed := validateSession(r)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"requireLogin": settings.RequireLogin,
		"authenticated": authed,
	})
}

func handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
		return
	}
	settings, err := db.GetSettings()
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Use default hash if none set
	expectedHash := settings.PasswordHash
	if expectedHash == "" {
		expectedHash = getDefaultHash()
	}
	if hashPassword(body.Password) != expectedHash {
		WriteErrorResponse(w, http.StatusUnauthorized, "Invalid password")
		return
	}
	token := issueSession()
	sessionsMu.Lock()
	sessions[token] = time.Now().Add(24 * time.Hour)
	sessionsMu.Unlock()
	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   86400,
	})
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if cookie, err := r.Cookie("session"); err == nil {
		sessionsMu.Lock()
		delete(sessions, cookie.Value)
		sessionsMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{
		Name:   "session",
		Value:  "",
		Path:   "/",
		MaxAge: -1,
	})
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func handleAuthChangePassword(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	// No session check needed — providing the current password IS the authentication proof.
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
		return
	}
	settings, err := db.GetSettings()
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	expectedHash := settings.PasswordHash
	if expectedHash == "" {
		expectedHash = getDefaultHash()
	}
	if hashPassword(body.CurrentPassword) != expectedHash {
		WriteErrorResponse(w, http.StatusUnauthorized, "Current password is incorrect")
		return
	}
	if len(body.NewPassword) < 6 {
		WriteErrorResponse(w, http.StatusBadRequest, "New password must be at least 6 characters")
		return
	}
	_, err = db.UpdateSettings(map[string]interface{}{
		"passwordHash": hashPassword(body.NewPassword),
	})
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}
