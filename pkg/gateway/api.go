package gateway

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"myAiRouter/internal/gateway/health"
	"myAiRouter/pkg/db"
	"myAiRouter/pkg/logger"
	"myAiRouter/pkg/optimizer"
	_ "myAiRouter/pkg/optimizer/passes"
	"myAiRouter/pkg/optimizer/planner"
	_ "myAiRouter/pkg/optimizer/profiles"
	"myAiRouter/pkg/optimizer/registry"
	"myAiRouter/pkg/optimizer/runner"
	_ "myAiRouter/pkg/optimizer/validators"
)

// In-memory session store (UUID → expiry)
var (
	sessions   = map[string]time.Time{}
	sessionsMu sync.RWMutex
)

func init() {
	go func() {
		ticker := time.NewTicker(30 * time.Minute)
		for range ticker.C {
			now := time.Now()
			sessionsMu.Lock()
			for k, exp := range sessions {
				if now.After(exp) {
					delete(sessions, k)
				}
			}
			sessionsMu.Unlock()
		}
	}()
}

func hashPassword(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

const defaultPasswordHash = "6e5a9c8ce6e5a9c8ce6e5a9c8ce6e5a9c8ce6e5a9c8ce6e5a9c8ce6e5a9c8ce" // placeholder, computed below

func getDefaultHash() string {
	return hashPassword("123456789")
}

func issueSession() string {
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		// crypto/rand must not silently fail for session tokens; fall back to
		// a time-bound hash so the login still works while staying unique.
		sum := sha256.Sum256([]byte(time.Now().String()))
	return hex.EncodeToString(sum[:])
}
	return hex.EncodeToString(token)
}

func ValidateSessionCookie(cookieVal string) bool {
	if cookieVal == "" {
		return false
	}
	sessionsMu.RLock()
	expiry, ok := sessions[cookieVal]
	sessionsMu.RUnlock()
	return ok && time.Now().Before(expiry)
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
	return ValidateSessionCookie(cookie.Value)
}

// requireAdminSession gates every admin API route. It is deny-by-default once
// dashboard login is enabled; only the auth endpoints below are always public,
// matching 9router's public allow-list model. When requireLogin is off the
// dashboard is intentionally open, so validateSession already returns true.
func requireAdminSession(next http.Handler) http.Handler {
	publicPrefixes := []string{"/api/auth/status", "/api/auth/login", "/api/auth/logout", "/api/health"}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, p := range publicPrefixes {
			if r.URL.Path == p || strings.HasPrefix(r.URL.Path, p+"/") {
				next.ServeHTTP(w, r)
				return
			}
		}
		if !validateSession(r) {
			WriteErrorResponse(w, http.StatusUnauthorized, "Unauthorized. Please sign in to access the dashboard.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func RegisterAdminRoutes(mux *http.ServeMux) {
	admin := http.NewServeMux()
	mux.Handle("/api/", requireAdminSession(admin))
	admin.HandleFunc("/api/settings", handleSettings)
	admin.HandleFunc("/api/providers", handleProviders)
	admin.HandleFunc("/api/providers/", handleProviderDetail) // Matches /api/providers/<id>
	admin.HandleFunc("/api/commandcode/token", handleCommandCodeToken)
	admin.HandleFunc("/api/provider-nodes", handleProviderNodes)
	admin.HandleFunc("/api/provider-nodes/", handleProviderNodeDetail) // Matches /api/provider-nodes/<id>
	admin.HandleFunc("/api/oauth/kilocode/initiate", handleKilocodeInitiate)
	admin.HandleFunc("/api/oauth/kilocode/poll", handleKilocodePoll)
	admin.HandleFunc("/api/keys", handleKeys)
	admin.HandleFunc("/api/apikeys", handleKeys)
	admin.HandleFunc("/api/combos", handleCombos)
	admin.HandleFunc("/api/usage/stats", handleUsageStats)
	admin.HandleFunc("/api/usage/logs", handleUsageLogs)
	admin.HandleFunc("/api/usage/charts", handleUsageCharts)
	admin.HandleFunc("/api/usage/models", handleUsageModels)
	admin.HandleFunc("/api/usage/provider-summary", handleProviderUsageSummary)
	admin.HandleFunc("/api/usage/export", handleUsageExport)
	admin.HandleFunc("/api/usage/import", handleUsageImport)
	admin.HandleFunc("/api/usage/inject", handleUsageInject)
	admin.HandleFunc("/api/models", HandleListModels)
	admin.HandleFunc("/api/models/disabled", handleModelsDisabled)
	admin.HandleFunc("/api/models/enabled", handleModelsEnabled)
	admin.HandleFunc("/api/models/custom", handleModelsCustom)
	admin.HandleFunc("/api/models/policies", handleModelPolicies)
	admin.HandleFunc("/api/models/thinking", handleModelsThinking)
	admin.HandleFunc("/api/models/pricing", handleModelPricing)
	admin.HandleFunc("/api/logs", handleServerLogs)
	admin.HandleFunc("/api/health", handleHealth)
	// Live activity feed for the Overview "running" animation (in-memory,
	// no DB access, safe to poll at ~1s).
	admin.HandleFunc("/api/live", handleLiveActivity)
	admin.HandleFunc("/api/connections/health", handleConnectionsHealth)
	admin.HandleFunc("/api/traces", handleTraces)
	admin.HandleFunc("/api/traces/", handleTraceDetail)
	// Prompt Optimizer
	admin.HandleFunc("/api/optimizer/engines", handleOptimizerEngines)
	admin.HandleFunc("/api/optimizer/preview", handleOptimizerPreview)
	admin.HandleFunc("/api/optimizer/benchmark", handleOptimizerBenchmark)
	// Auth
	admin.HandleFunc("/api/auth/status", handleAuthStatus)
	admin.HandleFunc("/api/auth/login", handleAuthLogin)
	admin.HandleFunc("/api/auth/logout", handleAuthLogout)
	admin.HandleFunc("/api/auth/change-password", handleAuthChangePassword)
	// Proxy routes (outbound HTTP/SOCKS5 proxies for provider connections)
	admin.HandleFunc("/api/proxies", handleProxyRoutes)
	admin.HandleFunc("/api/proxies/", handleProxyRouteDetail)
	admin.HandleFunc("/api/proxies/test/", handleProxyRouteTest)
	// Chat Sessions (JSONL streaming append storage)
	admin.HandleFunc("/api/system/metrics", HandleSystemMetrics)
	admin.HandleFunc("/api/chat/sessions", handleChatSessions)
	admin.HandleFunc("/api/chat/sessions/", handleChatSessionDetail)
	// Image Generation
	admin.HandleFunc("/api/images/generations", HandleImagesGenerations)
	// OAuth device-flow providers (xAI, Kimi, Copilot, Qoder, CodeBuddy, Cline…)
	admin.HandleFunc("/api/oauth/providers", handleOAuthProviders)
	admin.HandleFunc("/api/oauth/", handleOAuthRouter)
	// Config portability (providers/combos/models/proxies/settings)
	admin.HandleFunc("/api/config/export", HandleConfigExport)
	admin.HandleFunc("/api/config/import", HandleConfigImport)
	// Manual on-demand DB backup (scheduler also runs daily)
	admin.HandleFunc("/api/backup", HandleBackupNow)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

// handleConnectionsHealth exposes the in-memory per-connection health state
// (failure streaks, cooldowns, EWMA latency) for the admin UI.
func handleConnectionsHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	statuses := health.Get().Snapshot()
	byID := make(map[string]db.ProviderConnection)
	if conns, err := db.ListConnections(); err == nil {
		for _, c := range conns {
			byID[c.ID] = c
		}
	}

	enriched := make([]map[string]interface{}, 0, len(statuses))
	for _, s := range statuses {
		entry := map[string]interface{}{
			"connectionId":        s.ConnectionID,
			"healthy":             s.Healthy,
			"consecutiveFailures": s.ConsecutiveFailures,
			"cooldownSecondsLeft": s.CooldownSecondsLeft,
			"ewmaLatencyMs":       s.EwmaLatencyMs,
			"ewmaTtfbMs":          s.EwmaTTFBMs,
			"samples":             s.Samples,
		}
		if c, ok := byID[s.ConnectionID]; ok {
			entry["name"] = c.Name
			entry["provider"] = c.Provider
		}
		enriched = append(enriched, entry)
	}
	_ = json.NewEncoder(w).Encode(enriched)
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
		// Mask secrets before they leave the dashboard API; the full values
		// stay in the DB and are only used server-side when routing requests.
		for i := range conns {
			maskNodeData(conns[i].Data)
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

var commandCodeKeyRe = regexp.MustCompile(`user_[A-Za-z0-9]+`)

// maskNodeData replaces secret fields in a provider connection's data map
// (API keys, tokens, client secrets) with a masked placeholder for dashboard
// display. The map is mutated in place; the DB row is left untouched.
func maskNodeData(data map[string]interface{}) {
	if data == nil {
		return
	}
	for _, k := range []string{"apiKey", "token", "accessToken", "refreshToken", "clientSecret"} {
		if v, ok := data[k].(string); ok && v != "" {
			data[k] = maskSecret(v)
		}
	}
}

// maskSecret keeps the first/last 2 chars for identification, masks the rest.
func maskSecret(s string) string {
	if len(s) <= 8 {
		return "***"
	}
	return s[:2] + "***" + s[len(s)-2:]
}

// handleCommandCodeToken reads the local Command Code CLI session
// (~/.commandcode/auth.json) and returns its user_... API key so the UI
// can auto-provision a connection.
func handleCommandCodeToken(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	home, err := os.UserHomeDir()
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "cannot resolve home directory")
		return
	}
	path := filepath.Join(home, ".commandcode", "auth.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		WriteErrorResponse(w, http.StatusNotFound, "~/.commandcode/auth.json not found. Run `commandcode login` first.")
		return
	}
	apiKey := string(commandCodeKeyRe.Find(raw))
	if apiKey == "" {
		WriteErrorResponse(w, http.StatusNotFound, "no user_... key found in ~/.commandcode/auth.json")
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"apiKey": apiKey, "source": path})
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
	latencyMs := 0.0

	if res.Err != nil {
		errMsg = res.Err.Error()
	} else {
		if res.LatencyMs > 0 {
			latencyMs = res.LatencyMs
		}
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
		"latencyMs":  latencyMs,
		"error": errMsg,
		"testStatus": statusStr,
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

	if r.Method == http.MethodPatch {
		// Update an API key's scope (model allowlist + daily token cap).
		var payload struct {
			ID              string   `json:"id"`
			AllowedModels   []string `json:"allowedModels"`
			DailyTokenLimit int64    `json:"dailyTokenLimit"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.ID == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON or missing id")
			return
		}
		scope := db.ApiKeyScope{AllowedModels: payload.AllowedModels, DailyTokenLimit: payload.DailyTokenLimit}
		if err := db.UpdateApiKeyScope(payload.ID, scope); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
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

	if r.Method == http.MethodPut || r.Method == http.MethodPatch {
		id := r.URL.Query().Get("id")
		var combo db.Combo
		if err := json.NewDecoder(r.Body).Decode(&combo); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}
		if id == "" {
			id = combo.ID
		}
		if id == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "Missing id parameter")
			return
		}

		if err := db.UpdateCombo(id, combo.Name, combo.Kind, combo.Models, combo.Policy); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		combo.ID = id
		_ = json.NewEncoder(w).Encode(combo)
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
	provider := r.URL.Query().Get("provider")
	period := r.URL.Query().Get("period")
	startDate := r.URL.Query().Get("startDate")
	endDate := r.URL.Query().Get("endDate")
	stats, err := db.GetUsageStats(provider, period, startDate, endDate)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = json.NewEncoder(w).Encode(stats)
}

func handleUsageLogs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	provider := r.URL.Query().Get("provider")
	period := r.URL.Query().Get("period")

	pageStr := r.URL.Query().Get("page")
	perPageStr := r.URL.Query().Get("perPage")
	page, _ := strconv.Atoi(pageStr)
	perPage, _ := strconv.Atoi(perPageStr)
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 20
	}

	logs, total, err := db.GetRecentLogsPaginated(page, perPage, provider, period,
		r.URL.Query().Get("startDate"), r.URL.Query().Get("endDate"))
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"logs":    logs,
		"total":   total,
		"page":    page,
		"perPage": perPage,
	})
}

// ChartPoint is one bucket in the usage time-series chart.
	type ChartPoint struct {
		Label  string  `json:"label"`
		Tokens int     `json:"tokens"`
		Cost   float64 `json:"cost"`
	}

func handleUsageCharts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	provider := r.URL.Query().Get("provider")
	period := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("period")))

	chartPeriod := period
	if chartPeriod == "" {
		chartPeriod = "day"
	}
	whereClause, args := db.BuildUsageWhere(provider, chartPeriod,
		r.URL.Query().Get("startDate"), r.URL.Query().Get("endDate"))

	// Timestamps are stored as RFC3339 ("2026-09-20T15:21:26Z"), which SQLite's
	// date functions cannot parse without datetime() normalization. Buckets are
	// computed in WIB (+7) so chart labels line up with the operator's clock.
	const tz = "+7 hours"

	switch period {
	case "week", "7d", "month", "30d", "1m":
		days := 7
		layout := "Jan 02"
		if period == "month" || period == "30d" || period == "1m" {
			days = 30
			layout = "01/02"
		}
		points, labelMap := usageDailyBuckets(days, layout, tz)
		usageFillDaily(whereClause, args, tz, points, labelMap)
		_ = json.NewEncoder(w).Encode(points)
		return
	case "all":
		// Span the stored history: day count from the first WIB calendar day
		// with usage up to today inclusive, capped at 90 buckets so long-lived
		// installs stay readable.
		var days int
		_ = db.DB.QueryRow("SELECT CAST(julianday('now','+7 hours','start of day') - julianday(datetime(MIN(timestamp)),'+7 hours','start of day') AS INTEGER) + 1 FROM usageHistory" + whereClause, args...).Scan(&days)
		if days < 1 || days > 90 {
			days = 90
		}
		points, labelMap := usageDailyBuckets(days, "Jan 02", tz)
		usageFillDaily(whereClause, args, tz, points, labelMap)
		_ = json.NewEncoder(w).Encode(points)
		return
	}

	// Default: hourly buckets for the last 24 hours (Today / day / 24h).
	points := make([]ChartPoint, 24)
	for i := 0; i < 24; i++ {
		points[i] = ChartPoint{Label: fmt.Sprintf("%02d:00", i)}
	}

	rows, err := db.DB.Query(`
		SELECT 
			STRFTIME('%H', datetime(timestamp), '`+tz+`') as hour_part,
			SUM(promptTokens + completionTokens) as total_tokens,
			SUM(cost) as total_cost
		FROM usageHistory
		`+whereClause+`
		GROUP BY hour_part
	`, args...)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var hourStr string
			var tokens int
			var cost float64
			if err := rows.Scan(&hourStr, &tokens, &cost); err == nil {
				if h, err := strconv.Atoi(hourStr); err == nil && h >= 0 && h < 24 {
					points[h].Tokens = tokens
					points[h].Cost = math.Round(cost*10000) / 10000
				}
			}
		}
	}

	_ = json.NewEncoder(w).Encode(points)
}

// usageDailyBuckets builds an N-day window ending today (WIB), keyed by
// YYYY-MM-DD so row aggregation can be mapped back onto the labels.
func usageDailyBuckets(days int, labelLayout, tz string) ([]ChartPoint, map[string]int) {
	points := make([]ChartPoint, days)
	labelMap := make(map[string]int, days)
	for i := 0; i < days; i++ {
		d := time.Now().UTC().Add(time.Duration(7) * time.Hour).AddDate(0, 0, -(days - 1 - i))
		points[i] = ChartPoint{Label: d.Format(labelLayout)}
		labelMap[d.Format("2006-01-02")] = i
	}
	return points, labelMap
}

// usageFillDaily aggregates usage rows into the day buckets built above.
func usageFillDaily(whereClause string, args []interface{}, tz string, points []ChartPoint, labelMap map[string]int) {
	rows, err := db.DB.Query(`
		SELECT
			STRFTIME('%Y-%m-%d', datetime(timestamp), '`+tz+`') as date_part,
			SUM(promptTokens + completionTokens) as total_tokens,
			SUM(cost) as total_cost
		FROM usageHistory
		`+whereClause+`
		GROUP BY date_part
	`, args...)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var dateStr string
		var tokens int
		var cost float64
		if err := rows.Scan(&dateStr, &tokens, &cost); err == nil {
			if idx, ok := labelMap[dateStr]; ok {
				points[idx].Tokens = tokens
				points[idx].Cost = math.Round(cost*10000) / 10000
			}
		}
	}
}

func handleProviderNodes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodGet {
		nodes, err := db.ListProviderNodes()
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		// Mask secrets before they leave the dashboard API; the full values
		// stay in the DB and are only used server-side when routing requests.
		for i := range nodes {
			maskNodeData(nodes[i].Data)
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
	if r.Method == http.MethodDelete {
		logger.ClearLogs()
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"logs": []interface{}{}})
		return
	}
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	pageStr := r.URL.Query().Get("page")
	perPageStr := r.URL.Query().Get("perPage")
	page, _ := strconv.Atoi(pageStr)
	perPage, _ := strconv.Atoi(perPageStr)
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 20
	}

	logs, total := logger.GetLogsPaginated(page, perPage)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"logs":    logs,
		"total":   total,
		"page":    page,
		"perPage": perPage,
	})
}

func handleUsageModels(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	provider := r.URL.Query().Get("provider")
	period := r.URL.Query().Get("period")
	summaries, err := db.GetModelUsageSummary(provider, period,
		r.URL.Query().Get("startDate"), r.URL.Query().Get("endDate"))
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = json.NewEncoder(w).Encode(summaries)
}

func handleModelPricing(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodGet {
		provider := r.URL.Query().Get("providerAlias")
		if provider == "" {
			provider = r.URL.Query().Get("provider")
		}
		if r.URL.Query().Get("all") == "1" {
			// Bulk effective pricing: merge canonical defaults with overrides,
			// keyed by bare model id. Combos and unknown ids resolve later at
			// request time, so they are omitted here.
			models, err := HandleListModelsData(r)
			if err != nil {
				WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
				return
			}
			rates := make(map[string]ModelRateJSON, len(models))
			for _, m := range models {
				rate := db.GetPricing(m.OwnedBy, m.ID)
				rates[m.ID] = ModelRateJSON{Input: rate.Input, Output: rate.Output, Cached: rate.Cached}
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"rates": rates})
			return
		}
		overrides, err := db.GetPricingOverrides(provider)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"overrides": overrides,
		})
		return
	}

	if r.Method == http.MethodPost {
		var req struct {
			ProviderAlias string  `json:"providerAlias"`
			Provider      string  `json:"provider"`
			Model         string  `json:"model"`
			Input         float64 `json:"input"`
			Output        float64 `json:"output"`
			Cached        float64 `json:"cached"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "invalid request body")
			return
		}
		p := req.ProviderAlias
		if p == "" {
			p = req.Provider
		}
		if req.Model == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "model is required")
			return
		}
		rate := db.ModelRate{
			Input:  req.Input,
			Output: req.Output,
			Cached: req.Cached,
		}
		if err := db.SetPricingOverride(p, req.Model, rate); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}

	if r.Method == http.MethodDelete {
		provider := r.URL.Query().Get("providerAlias")
		if provider == "" {
			provider = r.URL.Query().Get("provider")
		}
		model := r.URL.Query().Get("model")
		if model == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "model is required")
			return
		}
		if err := db.DeletePricingOverride(provider, model); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func handleProviderUsageSummary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	summaries, err := db.GetProviderUsageSummary()
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

func handleModelPolicies(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !validateSession(r) {
		WriteErrorResponse(w, http.StatusUnauthorized, "Unauthorized. Please sign in to access the dashboard.")
		return
	}

	if r.Method == http.MethodGet {
		cfgs, err := db.ListModelConfigs()
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"policies": cfgs})
		return
	}

	if r.Method == http.MethodPost {
		var cfg db.ModelConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}
		if cfg.ID == "" || cfg.Routing.PrimaryProvider == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "id and primary_provider are required")
			return
		}
		if cfg.Name == "" {
			cfg.Name = cfg.ID
		}
		if err := db.SaveModelConfig(&cfg); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "policy": cfg})
		return
	}

	if r.Method == http.MethodDelete {
		id := r.URL.Query().Get("id")
		if id == "" {
			WriteErrorResponse(w, http.StatusBadRequest, "id parameter required")
			return
		}
		if err := db.DeleteModelConfig(id); err != nil {
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
	if r.Method == http.MethodDelete {
		_ = db.ResetFlatTraces()
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	pageStr := r.URL.Query().Get("page")
	perPageStr := r.URL.Query().Get("perPage")
	page, _ := strconv.Atoi(pageStr)
	perPage, _ := strconv.Atoi(perPageStr)
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 20
	}

	traces, total, err := db.GetFlatTracesPaginated(page, perPage)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	if traces == nil {
		traces = []*db.FlatTrace{}
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"traces":  traces,
		"total":   total,
		"page":    page,
		"perPage": perPage,
	})
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

	trace, err := db.GetFlatTraceByID(id)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	if trace == nil {
		WriteErrorResponse(w, http.StatusNotFound, "Trace not found")
		return
	}

	_ = json.NewEncoder(w).Encode(trace)
}

// ──────────────────── Auth handlers ────────────────────

// AppVersion is set by main() from the CLI version string and exposed to the
// admin UI through /api/auth/status.
var AppVersion string

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
		"requireLogin":  settings.RequireLogin,
		"authenticated": authed,
		"hasPassword":   settings.PasswordHash != "",
		"version":       AppVersion,
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
	http.SetCookie(w, sessionCookie(token, 86400))
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})
}

func sessionCookie(value string, maxAge int) *http.Cookie {
	c := &http.Cookie{
		Name:     "session",
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	}
	if maxAge < 0 {
		c.Expires = time.Unix(0, 0)
	}
	return c
}

func handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if cookie, err := r.Cookie("session"); err == nil {
		sessionsMu.Lock()
		delete(sessions, cookie.Value)
		sessionsMu.Unlock()
	}
	http.SetCookie(w, sessionCookie("", -1))
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

func handleOptimizerEngines(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		WriteErrorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	_ = json.NewEncoder(w).Encode(registry.GetEngines())
}

type PreviewRequest struct {
	Prompt        string            `json:"prompt"`
	Engine        string            `json:"engine"`
	Power         string            `json:"power"`
	Goal          string            `json:"goal"`
	PipelineSteps []db.PipelineStep `json:"pipelineSteps"`
}

func handleOptimizerPreview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		WriteErrorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req PreviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if req.Engine == "" {
		req.Engine = "auto"
	}
	if req.Power == "" {
		req.Power = "balanced"
	}
	if req.Goal == "" {
		req.Goal = "balanced"
	}

	messages := []interface{}{
		map[string]interface{}{"role": "user", "content": req.Prompt},
	}

	ratio := 0.60
	aggr := 0.5
	switch req.Power {
	case "lite":
		ratio = 0.85
		aggr = 0.3
	case "balanced":
		ratio = 0.60
		aggr = 0.5
	case "aggressive":
		ratio = 0.40
		aggr = 0.7
	case "extreme":
		ratio = 0.20
		aggr = 0.9
	}

	optCtx := &optimizer.OptimizationContext{
		Context:  r.Context(),
		Messages: messages,
		Goal:     req.Goal,
		Profile: optimizer.CompressionProfile{
			Name:           req.Power,
			TargetRatio:    ratio,
			Aggressiveness: aggr,
		},
		Metadata: make(map[string]interface{}),
	}

	loadedAnalyzers := registry.GetAnalyzers()
	for _, a := range loadedAnalyzers {
		_ = a.Analyze(optCtx)
	}

	plannerObj := planner.NewPlanner()
	plan, err := plannerObj.Plan(optCtx, req.Engine, req.PipelineSteps)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "Planning failed: "+err.Error())
		return
	}

	runnerObj := runner.NewRunner()
	res, err := runnerObj.Run(optCtx, plan)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "Runner failed: "+err.Error())
		return
	}

	var optimizedPrompt string
	if len(res.Messages) > 0 {
		if m, ok := res.Messages[0].(map[string]interface{}); ok {
			optimizedPrompt, _ = m["content"].(string)
		}
	}

	type PreviewResponse struct {
		Plan   interface{} `json:"plan"`
		Before interface{} `json:"before"`
		After  interface{} `json:"after"`
		Passes []string    `json:"passes"`
		Report interface{} `json:"report"`
	}

	_ = json.NewEncoder(w).Encode(PreviewResponse{
		Plan: plan,
		Before: map[string]interface{}{
			"prompt": req.Prompt,
			"tokens": res.OriginalTokens,
			"bytes":  res.OriginalBytes,
		},
		After: map[string]interface{}{
			"prompt": optimizedPrompt,
			"tokens": res.OptimizedTokens,
			"bytes":  res.OptimizedBytes,
		},
		Passes: res.Passes,
		Report: res,
	})
}

func handleOptimizerBenchmark(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		WriteErrorResponse(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	traces, _, err := db.GetFlatTracesPaginated(1, 100)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}

	settings, err := db.GetSettings()
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}

	ratio := 0.60
	aggr := 0.5
	switch settings.OptimizationProfile {
	case "lite":
		ratio = 0.85
		aggr = 0.3
	case "balanced":
		ratio = 0.60
		aggr = 0.5
	case "aggressive":
		ratio = 0.40
		aggr = 0.7
	case "extreme":
		ratio = 0.20
		aggr = 0.9
	}

	type EngineStats struct {
		Savings     float64 `json:"savings"`
		LatencyMs   float64 `json:"latencyMs"`
		SuccessRate float64 `json:"successRate"`
		SampleCount int     `json:"sampleCount"`
	}

	results := make(map[string]map[string]*EngineStats)
	enginesToTest := []string{"tool", "structure", "fusion"}

	for _, engine := range enginesToTest {
		results[engine] = make(map[string]*EngineStats)
		for _, cat := range []string{"json", "code", "log", "markdown", "text", "all"} {
			results[engine][cat] = &EngineStats{Savings: 0, LatencyMs: 0, SuccessRate: 0, SampleCount: 0}
		}
	}

	plannerObj := planner.NewPlanner()
	runnerObj := runner.NewRunner()
	loadedAnalyzers := registry.GetAnalyzers()

	for _, t := range traces {
		if t.Request == "" {
			continue
		}

		origMsgs := []interface{}{
			map[string]interface{}{
				"role":    "user",
				"content": t.Request,
			},
		}

		optCtx := &optimizer.OptimizationContext{
			Context:  r.Context(),
			Messages: origMsgs,
			Goal:     settings.OptimizationGoal,
			Profile: optimizer.CompressionProfile{
				Name:           settings.OptimizationProfile,
				TargetRatio:    ratio,
				Aggressiveness: aggr,
			},
			Metadata: make(map[string]interface{}),
		}

		for _, a := range loadedAnalyzers {
			_ = a.Analyze(optCtx)
		}

		category := optCtx.ContentType

		for _, engine := range enginesToTest {
			optCtxCopy := optCtx.Clone()
			plan, err := plannerObj.Plan(optCtxCopy, engine, nil)
			if err != nil {
				continue
			}

			t0 := time.Now()
			res, err := runnerObj.Run(optCtxCopy, plan)
			dur := time.Since(t0)

			savings := 0.0
			success := 1.0
			if err != nil {
				success = 0.0
			} else if res.OriginalTokens > 0 {
				savings = float64(res.SavedTokens) / float64(res.OriginalTokens)
			}

			catStats := results[engine][category]
			if catStats != nil {
				catStats.Savings += savings
				catStats.LatencyMs += float64(dur.Milliseconds())
				catStats.SuccessRate += success
				catStats.SampleCount++
			}

			allStats := results[engine]["all"]
			allStats.Savings += savings
			allStats.LatencyMs += float64(dur.Milliseconds())
			allStats.SuccessRate += success
			allStats.SampleCount++
		}
	}

	for _, engine := range enginesToTest {
		for _, cat := range []string{"json", "code", "log", "markdown", "text", "all"} {
			s := results[engine][cat]
			if s.SampleCount > 0 {
				s.Savings = (s.Savings / float64(s.SampleCount)) * 100
				s.LatencyMs = s.LatencyMs / float64(s.SampleCount)
				s.SuccessRate = (s.SuccessRate / float64(s.SampleCount)) * 100
			}
		}
	}

	_ = json.NewEncoder(w).Encode(results)
}

func handleUsageExport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	overview, err := db.GetMetricsOverview()
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "Exporting metrics overview: "+err.Error())
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=metrics_overview_%s.json", time.Now().Format("20060102_150405")))
	_ = json.NewEncoder(w).Encode(overview)
}

func handleUsageImport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var overview db.MetricsOverview
	if err := json.NewDecoder(r.Body).Decode(&overview); err != nil {
		WriteErrorResponse(w, http.StatusBadRequest, "Invalid metrics JSON payload: "+err.Error())
		return
	}

	if err := db.ImportMetricsOverview(&overview); err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, "Importing metrics overview: "+err.Error())
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Metrics overview imported and synced successfully",
	})
}

func handleUsageInject(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var payload struct {
		TotalRequests         *int `json:"totalRequests"`
		TotalPromptTokens     *int `json:"totalPromptTokens"`
		TotalCompletionTokens *int `json:"totalCompletionTokens"`
		TotalCachedTokens     *int `json:"totalCachedTokens"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON: "+err.Error())
		return
	}

	if err := db.InjectUsageTotals(&db.InjectUsageRequest{
		TotalRequests:         payload.TotalRequests,
		TotalPromptTokens:     payload.TotalPromptTokens,
		TotalCompletionTokens: payload.TotalCompletionTokens,
		TotalCachedTokens:     payload.TotalCachedTokens,
	}); err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
}

func handleModelsThinking(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodGet {
		provider := r.URL.Query().Get("providerAlias")
		m, err := db.GetThinkingModels(provider)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"thinkingMap": m})
		return
	}

	if r.Method == http.MethodPost {
		var req struct {
			ProviderAlias string `json:"providerAlias"`
			ModelID       string `json:"modelId"`
			Enabled       bool   `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}
		if err := db.SetThinkingModel(req.ProviderAlias, req.ModelID, req.Enabled); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}
