package db

import (
	"database/sql"
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"time"
)

type TokenUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	CachedTokens     int `json:"cached_tokens"`
}

type UsageEntry struct {
	ID               int64       `json:"id"`
	Timestamp        string      `json:"timestamp"`
	Provider         string      `json:"provider"`
	Model            string      `json:"model"`
	ConnectionID     string      `json:"connectionId"`
	APIKey           string      `json:"apiKey"`
	APIKeyName       string      `json:"apiKeyName"`
	Endpoint         string      `json:"endpoint"`
	PromptTokens     int         `json:"promptTokens"`
	CompletionTokens int         `json:"completionTokens"`
	CachedTokens     int         `json:"cachedTokens"`
	Cost             float64     `json:"cost"`
	Status           string      `json:"status"`
	Tokens           TokenUsage  `json:"tokens"`
	Meta             string      `json:"meta"`
}

type UsageStats struct {
	TotalRequests         int     `json:"totalRequests"`
	TotalPromptTokens     int     `json:"totalPromptTokens"`
	TotalCompletionTokens int     `json:"totalCompletionTokens"`
	TotalCachedTokens     int     `json:"totalCachedTokens"`
	TotalCost             float64 `json:"totalCost"`
}

type ChartBucket struct {
	Timestamp        string  `json:"timestamp"`
	Requests         int     `json:"requests"`
	PromptTokens     int     `json:"promptTokens"`
	CompletionTokens int     `json:"completionTokens"`
	Cost             float64 `json:"cost"`
}

// ModelRate — pricing in $/1M tokens
type ModelRate struct {
	Input         float64
	Output        float64
	Cached        float64
	Reasoning     float64
	CacheCreation float64
}

// Full canonical model pricing from 9router — provider-agnostic
var ModelPricing = map[string]ModelRate{
	// === Anthropic / Claude ===
	"claude-opus-4-6":              {5.00, 25.00, 0.50, 25.00, 6.25},
	"claude-opus-4-5-20251101":     {5.00, 25.00, 0.50, 25.00, 6.25},
	"claude-sonnet-4-6":            {3.00, 15.00, 0.30, 15.00, 3.75},
	"claude-sonnet-4-5-20250929":   {3.00, 15.00, 0.30, 15.00, 3.75},
	"claude-haiku-4-5-20251001":    {1.00, 5.00, 0.10, 5.00, 1.25},
	"claude-sonnet-4-20250514":     {3.00, 15.00, 1.50, 15.00, 3.00},
	"claude-opus-4-20250514":       {15.00, 25.00, 7.50, 112.50, 15.00},
	"claude-3-5-sonnet-20241022":   {3.00, 15.00, 1.50, 15.00, 3.00},
	"claude-haiku-4.5":             {0.50, 2.50, 0.05, 3.75, 0.50},
	"claude-opus-4.1":              {5.00, 25.00, 0.50, 37.50, 5.00},
	"claude-opus-4.5":              {5.00, 25.00, 0.50, 37.50, 5.00},
	"claude-opus-4.6":              {5.00, 25.00, 0.50, 37.50, 5.00},
	"claude-sonnet-4":              {3.00, 15.00, 0.30, 22.50, 3.00},
	"claude-sonnet-4.5":            {3.00, 15.00, 0.30, 22.50, 3.00},
	"claude-sonnet-4.6":            {3.00, 15.00, 0.30, 22.50, 3.00},
	"claude-opus-4-5-thinking":     {5.00, 25.00, 0.50, 37.50, 5.00},
	"claude-opus-4-6-thinking":     {5.00, 25.00, 0.50, 37.50, 5.00},
	"claude-fable-5":               {10.00, 50.00, 1.00, 50.00, 12.50},

	// === OpenAI / GPT ===
	"gpt-3.5-turbo":                {0.50, 1.50, 0.25, 2.25, 0.50},
	"gpt-4":                        {2.50, 10.00, 1.25, 15.00, 2.50},
	"gpt-4-turbo":                  {10.00, 30.00, 5.00, 45.00, 10.00},
	"gpt-4o":                       {2.50, 10.00, 1.25, 15.00, 2.50},
	"gpt-4o-mini":                  {0.15, 0.60, 0.075, 0.90, 0.15},
	"gpt-4.1":                      {2.50, 10.00, 1.25, 15.00, 2.50},
	"gpt-5":                        {1.25, 10.00, 0.625, 10.00, 1.25},
	"gpt-5-mini":                   {0.25, 2.00, 0.125, 2.00, 0.25},
	"gpt-5-codex":                  {1.25, 10.00, 0.625, 10.00, 1.25},
	"gpt-5.1":                      {1.25, 10.00, 0.625, 10.00, 1.25},
	"gpt-5.1-codex":                {1.25, 10.00, 0.625, 10.00, 1.25},
	"gpt-5.1-codex-mini":           {1.50, 6.00, 0.75, 9.00, 1.50},
	"gpt-5.1-codex-mini-high":      {2.00, 8.00, 1.00, 12.00, 2.00},
	"gpt-5.1-codex-max":            {8.00, 32.00, 4.00, 48.00, 8.00},
	"gpt-5.2":                      {1.75, 14.00, 0.175, 14.00, 1.75},
	"gpt-5.2-codex":                {1.75, 14.00, 0.175, 14.00, 1.75},
	"gpt-5.3-codex":                {1.75, 14.00, 0.175, 14.00, 1.75},
	"gpt-5.3-codex-spark":          {3.00, 12.00, 0.30, 12.00, 3.00},
	"gpt-5.6":                      {2.50, 15.00, 0.25, 15.00, 2.50},
	"gpt-5.6-luna":                 {1.00, 6.00, 0.10, 6.00, 1.00},
	"gpt-5.6-terra":                {2.50, 15.00, 0.25, 15.00, 2.50},
	"gpt-5.6-sol":                  {5.00, 30.00, 0.50, 30.00, 5.00},
	"o1":                           {15.00, 60.00, 7.50, 90.00, 15.00},
	"o1-mini":                      {3.00, 12.00, 1.50, 18.00, 3.00},
	"o3":                           {10.00, 40.00, 5.00, 60.00, 10.00},

	// === Gemini ===
	"gemini-3-flash-preview":       {0.50, 3.00, 0.03, 4.50, 0.50},
	"gemini-3-pro-preview":         {2.00, 12.00, 0.25, 18.00, 2.00},
	"gemini-3.1-pro-low":           {2.00, 12.00, 0.25, 18.00, 2.00},
	"gemini-3.1-pro-high":          {4.00, 18.00, 0.50, 27.00, 4.00},
	"gemini-3-flash":               {0.50, 3.00, 0.03, 4.50, 0.50},
	"gemini-2.5-pro":               {2.00, 12.00, 0.25, 18.00, 2.00},
	"gemini-2.5-flash":             {0.30, 2.50, 0.03, 3.75, 0.30},
	"gemini-2.5-flash-lite":        {0.15, 1.25, 0.015, 1.875, 0.15},

	// === Qwen ===
	"qwen3-coder-plus":             {1.00, 4.00, 0.50, 6.00, 1.00},
	"qwen3-coder-flash":            {0.50, 2.00, 0.25, 3.00, 0.50},

	// === Kimi ===
	"kimi-k2":                      {1.00, 4.00, 0.50, 6.00, 1.00},
	"kimi-k2-thinking":             {1.50, 6.00, 0.75, 9.00, 1.50},
	"kimi-k2.5":                    {1.20, 4.80, 0.60, 7.20, 1.20},
	"kimi-k2.5-thinking":           {1.80, 7.20, 0.90, 10.80, 1.80},

	// === DeepSeek ===
	"deepseek-chat":                {0.14, 0.28, 0.0028, 0.28, 0.14},
	"deepseek-reasoner":            {0.14, 0.28, 0.0028, 0.28, 0.14},
	"deepseek-r1":                  {0.14, 0.28, 0.0028, 0.28, 0.14},
	"deepseek-v3.2-chat":           {0.14, 0.28, 0.0028, 0.28, 0.14},
	"deepseek-v3.2-reasoner":       {0.14, 0.28, 0.0028, 0.28, 0.14},
	"deepseek-v4-flash":            {0.14, 0.28, 0.0028, 0.28, 0.14},
	"deepseek-v4-pro":              {0.435, 0.87, 0.003625, 0.87, 0.435},

	// === GLM ===
	"glm-4.6":                      {0.50, 2.00, 0.25, 3.00, 0.50},
	"glm-4.6v":                     {0.75, 3.00, 0.375, 4.50, 0.75},
	"glm-4.7":                      {0.75, 3.00, 0.375, 4.50, 0.75},
	"glm-5":                        {1.00, 4.00, 0.50, 6.00, 1.00},

	// === MiniMax ===
	"MiniMax-M3":                   {0.30, 1.20, 0.06, 1.80, 0.30},
	"MiniMax-M2.1":                 {0.50, 2.00, 0.25, 3.00, 0.50},
	"MiniMax-M2.5":                 {0.50, 2.00, 0.25, 3.00, 0.50},
	"MiniMax-M2.7":                 {0.50, 2.00, 0.25, 3.00, 0.50},
	"minimax-m2.1":                 {0.50, 2.00, 0.25, 3.00, 0.50},
	"minimax-m2.5":                 {0.60, 2.40, 0.30, 3.60, 0.60},

	// === Misc ===
	"grok-code-fast-1":             {0.50, 2.00, 0.25, 3.00, 0.50},
	"oswe-vscode-prime":            {1.00, 4.00, 0.50, 6.00, 1.00},
	"gpt-oss-120b-medium":          {0.50, 2.00, 0.25, 3.00, 0.50},
	"auto":                         {2.00, 8.00, 1.00, 12.00, 2.00},
}

type PatternRate struct {
	Pattern string
	Rate    ModelRate
}

var PatternPricing = []PatternRate{
	// --- Codex variants ---
	{Pattern: "*-codex-xhigh",      Rate: ModelRate{10.00, 40.00, 5.00, 60.00, 10.00}},
	{Pattern: "*-codex-high",       Rate: ModelRate{8.00, 32.00, 4.00, 48.00, 8.00}},
	{Pattern: "*-codex-max",        Rate: ModelRate{8.00, 32.00, 4.00, 48.00, 8.00}},
	{Pattern: "*-codex-mini-*",     Rate: ModelRate{1.50, 6.00, 0.75, 9.00, 1.50}},
	{Pattern: "*-codex-mini",       Rate: ModelRate{1.50, 6.00, 0.75, 9.00, 1.50}},
	{Pattern: "*-codex-low",        Rate: ModelRate{1.75, 14.00, 0.175, 14.00, 1.75}},
	{Pattern: "*-codex-none",       Rate: ModelRate{1.75, 14.00, 0.175, 14.00, 1.75}},
	{Pattern: "*-codex-spark",      Rate: ModelRate{3.00, 12.00, 0.30, 12.00, 3.00}},
	{Pattern: "codex-*",            Rate: ModelRate{1.75, 14.00, 0.175, 14.00, 1.75}},
	{Pattern: "*-codex",            Rate: ModelRate{1.75, 14.00, 0.175, 14.00, 1.75}},

	// --- Claude ---
	{Pattern: "claude-opus-*",      Rate: ModelRate{5.00, 25.00, 0.50, 25.00, 6.25}},
	{Pattern: "claude-sonnet-*",    Rate: ModelRate{3.00, 15.00, 0.30, 15.00, 3.75}},
	{Pattern: "claude-haiku-*",     Rate: ModelRate{1.00, 5.00, 0.10, 5.00, 1.25}},
	{Pattern: "claude-*",           Rate: ModelRate{3.00, 15.00, 0.30, 15.00, 3.75}},

	// --- Gemini (specific first, generic last) ---
	{Pattern: "gemini-*-flash-lite", Rate: ModelRate{0.15, 1.25, 0.015, 1.875, 0.15}},
	{Pattern: "gemini-*-flash",     Rate: ModelRate{0.30, 2.50, 0.03, 3.75, 0.30}},
	{Pattern: "gemini-*-pro",       Rate: ModelRate{2.00, 12.00, 0.25, 18.00, 2.00}},
	{Pattern: "gemini-3-*",         Rate: ModelRate{0.50, 3.00, 0.03, 4.50, 0.50}},
	{Pattern: "gemini-2.5-*",       Rate: ModelRate{0.30, 2.50, 0.03, 3.75, 0.30}},
	{Pattern: "gemini-*",           Rate: ModelRate{0.50, 3.00, 0.03, 4.50, 0.50}},

	// --- GPT (specific first, generic last) ---
	{Pattern: "gpt-5.6-*",          Rate: ModelRate{2.50, 15.00, 0.25, 15.00, 2.50}},
	{Pattern: "gpt-5.3-*",          Rate: ModelRate{1.75, 14.00, 0.175, 14.00, 1.75}},
	{Pattern: "gpt-5.2-*",          Rate: ModelRate{1.75, 14.00, 0.175, 14.00, 1.75}},
	{Pattern: "gpt-5.1-*",          Rate: ModelRate{1.25, 10.00, 0.625, 10.00, 1.25}},
	{Pattern: "gpt-5-*",            Rate: ModelRate{1.25, 10.00, 0.625, 10.00, 1.25}},
	{Pattern: "gpt-5*",             Rate: ModelRate{1.25, 10.00, 0.625, 10.00, 1.25}},
	{Pattern: "gpt-4o-*",           Rate: ModelRate{0.15, 0.60, 0.075, 0.90, 0.15}},
	{Pattern: "gpt-4o",             Rate: ModelRate{2.50, 10.00, 1.25, 15.00, 2.50}},
	{Pattern: "gpt-4*",             Rate: ModelRate{2.50, 10.00, 1.25, 15.00, 2.50}},

	// --- o1 / o-series ---
	{Pattern: "o1-*",               Rate: ModelRate{3.00, 12.00, 1.50, 18.00, 3.00}},
	{Pattern: "o1",                 Rate: ModelRate{15.00, 60.00, 7.50, 90.00, 15.00}},
	{Pattern: "o3-*",               Rate: ModelRate{10.00, 40.00, 5.00, 60.00, 10.00}},
	{Pattern: "o4-*",               Rate: ModelRate{2.00, 8.00, 1.00, 12.00, 2.00}},

	// --- Qwen ---
	{Pattern: "qwen3-coder-*",      Rate: ModelRate{1.00, 4.00, 0.50, 6.00, 1.00}},
	{Pattern: "qwen*-coder-*",      Rate: ModelRate{1.00, 4.00, 0.50, 6.00, 1.00}},
	{Pattern: "qwen*",              Rate: ModelRate{0.50, 2.00, 0.25, 3.00, 0.50}},

	// --- Kimi ---
	{Pattern: "kimi-*-thinking",    Rate: ModelRate{1.80, 7.20, 0.90, 10.80, 1.80}},
	{Pattern: "kimi-k2*",           Rate: ModelRate{1.20, 4.80, 0.60, 7.20, 1.20}},
	{Pattern: "kimi-*",             Rate: ModelRate{1.00, 4.00, 0.50, 6.00, 1.00}},

	// --- DeepSeek ---
	{Pattern: "deepseek-*reasoner*", Rate: ModelRate{0.14, 0.28, 0.0028, 0.28, 0.14}},
	{Pattern: "deepseek-r*",        Rate: ModelRate{0.14, 0.28, 0.0028, 0.28, 0.14}},
	{Pattern: "deepseek-v*",        Rate: ModelRate{0.14, 0.28, 0.0028, 0.28, 0.14}},
	{Pattern: "deepseek-*",         Rate: ModelRate{0.14, 0.28, 0.0028, 0.28, 0.14}},

	// --- GLM ---
	{Pattern: "glm-5*",             Rate: ModelRate{1.00, 4.00, 0.50, 6.00, 1.00}},
	{Pattern: "glm-4*",             Rate: ModelRate{0.75, 3.00, 0.375, 4.50, 0.75}},
	{Pattern: "glm-*",              Rate: ModelRate{0.50, 2.00, 0.25, 3.00, 0.50}},

	// --- MiniMax ---
	{Pattern: "MiniMax-*",          Rate: ModelRate{0.50, 2.00, 0.25, 3.00, 0.50}},
	{Pattern: "minimax-*",          Rate: ModelRate{0.50, 2.00, 0.25, 3.00, 0.50}},

	// --- Grok ---
	{Pattern: "grok-code-*",        Rate: ModelRate{0.50, 2.00, 0.25, 3.00, 0.50}},
	{Pattern: "grok-*",             Rate: ModelRate{0.50, 2.00, 0.25, 3.00, 0.50}},
}

func matchPattern(pattern, model string) bool {
	escapedPattern := regexp.QuoteMeta(pattern)
	escapedPattern = strings.ReplaceAll(escapedPattern, "\\*", ".*")
	match, _ := regexp.MatchString("(?i)^"+escapedPattern+"$", model)
	return match
}

func GetPricing(provider, model string) ModelRate {
	// 0. Check KV pricing override first
	if rate, ok := GetPricingOverride(provider, model); ok {
		return rate
	}

	baseModel := model
	if idx := strings.LastIndex(model, "/"); idx != -1 {
		baseModel = model[idx+1:]
	}

	// 1. Exact canonical check
	if rate, ok := ModelPricing[baseModel]; ok {
		return rate
	}
	if rate, ok := ModelPricing[model]; ok {
		return rate
	}

	// 2. Pattern check
	for _, pr := range PatternPricing {
		if matchPattern(pr.Pattern, baseModel) || matchPattern(pr.Pattern, model) {
			return pr.Rate
		}
	}

	// Default fallback
	return ModelPricing["auto"]
}

func CalculateCost(provider, model string, prompt, output, cached int) float64 {
	pricing := GetPricing(provider, model)

	cacheCreation := 0
	inputTokens := prompt
	if cached > 0 {
		cacheCreation = cached / 2
		if cacheCreation > inputTokens {
			cacheCreation = inputTokens
		}
	}

	nonCachedInput := inputTokens - cached - cacheCreation
	if nonCachedInput < 0 {
		nonCachedInput = 0
	}

	cost := float64(nonCachedInput) * (pricing.Input / 1000000.0)
	if cached > 0 {
		cost += float64(cached) * (pricing.Cached / 1000000.0)
	}
	if cacheCreation > 0 && pricing.CacheCreation > 0 {
		cost += float64(cacheCreation) * (pricing.CacheCreation / 1000000.0)
	}
	cost += float64(output) * (pricing.Output / 1000000.0)

	// Apply reasoning pricing for o-series models
	if strings.HasPrefix(model, "o") || strings.HasPrefix(model, "o1") || strings.HasPrefix(model, "o3") || strings.HasPrefix(model, "o4") {
		if pricing.Reasoning > 0 {
			reasoningTokens := output / 3
			if reasoningTokens > 0 {
				cost += float64(reasoningTokens) * ((pricing.Reasoning - pricing.Output) / 1000000.0)
			}
		}
	}

	return cost
}

func SaveRequestUsage(entry *UsageEntry) error {
	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	entry.Cost = CalculateCost(entry.Provider, entry.Model, entry.PromptTokens, entry.CompletionTokens, entry.CachedTokens)

	tokensJSON, _ := json.Marshal(entry.Tokens)
	if entry.Meta == "" {
		entry.Meta = "{}"
	}

	res, err := DB.Exec(
		`INSERT INTO usageHistory (timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cachedTokens, cost, status, tokens, meta)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entry.Timestamp, entry.Provider, entry.Model, entry.ConnectionID, entry.APIKey, entry.Endpoint,
		entry.PromptTokens, entry.CompletionTokens, entry.CachedTokens, entry.Cost, entry.Status, string(tokensJSON), entry.Meta,
	)
	if err != nil {
		return err
	}

	id, err := res.LastInsertId()
	if err == nil {
		entry.ID = id
	}

	// Update daily usage aggregates
	dateKey := entry.Timestamp[:10] // YYYY-MM-DD
	return updateDailySummary(dateKey, entry)
}

type DailySummaryData struct {
	Requests         int     `json:"requests"`
	PromptTokens     int     `json:"promptTokens"`
	CompletionTokens int     `json:"completionTokens"`
	CachedTokens     int     `json:"cachedTokens"`
	Cost             float64 `json:"cost"`
}

func updateDailySummary(dateKey string, entry *UsageEntry) error {
	var dataStr string
	var summary DailySummaryData

	err := DB.QueryRow("SELECT data FROM usageDaily WHERE dateKey = ?", dateKey).Scan(&dataStr)
	if err == nil {
		_ = json.Unmarshal([]byte(dataStr), &summary)
	}

	summary.Requests += 1
	summary.PromptTokens += entry.PromptTokens
	summary.CompletionTokens += entry.CompletionTokens
	summary.CachedTokens += entry.CachedTokens
	summary.Cost += entry.Cost

	updatedBytes, _ := json.Marshal(summary)

	_, err = DB.Exec(
		"INSERT INTO usageDaily (dateKey, data) VALUES (?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data",
		dateKey, string(updatedBytes),
	)
	return err
}

func BuildUsageWhere(provider, period string) (string, []interface{}) {
	var clauses []string
	var args []interface{}

	if provider != "" {
		clauses = append(clauses, "(LOWER(provider) = LOWER(?) OR LOWER(connectionId) = LOWER(?) OR LOWER(model) LIKE LOWER(?))")
		args = append(args, provider, provider, provider+"/%")
	}

	switch strings.ToLower(strings.TrimSpace(period)) {
	case "day", "1d", "24h":
		clauses = append(clauses, "timestamp >= datetime('now', '-1 day')")
	case "week", "7d":
		clauses = append(clauses, "timestamp >= datetime('now', '-7 days')")
	case "month", "30d", "1m":
		clauses = append(clauses, "timestamp >= datetime('now', '-30 days')")
	}

	where := ""
	if len(clauses) > 0 {
		where = " WHERE " + strings.Join(clauses, " AND ")
	}
	return where, args
}

func GetUsageStats(provider string, period string) (*UsageStats, error) {
	var stats UsageStats
	where, args := BuildUsageWhere(provider, period)

	row := DB.QueryRow("SELECT COUNT(*), SUM(promptTokens), SUM(completionTokens), SUM(cost) FROM usageHistory"+where, args...)
	var requests, prompt, completion sql.NullInt64
	var cost sql.NullFloat64
	if err := row.Scan(&requests, &prompt, &completion, &cost); err != nil {
		return nil, err
	}

	stats.TotalRequests = int(requests.Int64)
	stats.TotalPromptTokens = int(prompt.Int64)
	stats.TotalCompletionTokens = int(completion.Int64)
	stats.TotalCost = cost.Float64

	// Get cached tokens sum
	var cachedSum int
	_ = DB.QueryRow("SELECT COALESCE(SUM(cachedTokens), 0) FROM usageHistory"+where, args...).Scan(&cachedSum)
	stats.TotalCachedTokens = cachedSum
	return &stats, nil
}

func GetRecentLogs(limit int, provider string, period string) ([]UsageEntry, error) {
	entries, _, err := GetRecentLogsPaginated(1, limit, provider, period)
	return entries, err
}

func GetRecentLogsPaginated(page, perPage int, provider string, period string) ([]UsageEntry, int, error) {
	keys, err := ListApiKeys()
	keyNameMap := make(map[string]string)
	if err == nil {
		for _, k := range keys {
			keyNameMap[k.Key] = k.Name
		}
	}

	where, args := BuildUsageWhere(provider, period)

	var total int
	countQuery := `SELECT COUNT(*) FROM usageHistory` + where
	if err := DB.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	if offset < 0 {
		offset = 0
	}

	query := `SELECT id, timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cachedTokens, cost, status, tokens, meta 
		FROM usageHistory` + where + " ORDER BY id DESC LIMIT ? OFFSET ?"
	queryArgs := append(args, perPage, offset)

	rows, err := DB.Query(query, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var logs []UsageEntry
	for rows.Next() {
		var e UsageEntry
		var tokensStr string
		if err := rows.Scan(&e.ID, &e.Timestamp, &e.Provider, &e.Model, &e.ConnectionID, &e.APIKey, &e.Endpoint, &e.PromptTokens, &e.CompletionTokens, &e.CachedTokens, &e.Cost, &e.Status, &tokensStr, &e.Meta); err != nil {
			return nil, 0, err
		}
		_ = json.Unmarshal([]byte(tokensStr), &e.Tokens)
		if e.CachedTokens == 0 {
			e.CachedTokens = e.Tokens.CachedTokens
		}

		e.APIKeyName = keyNameMap[e.APIKey]
		if e.APIKeyName == "" && e.APIKey != "" {
			if e.APIKey == "guest" {
				e.APIKeyName = "Guest"
			} else if len(e.APIKey) > 10 {
				e.APIKeyName = e.APIKey[:8] + "..."
			} else {
				e.APIKeyName = e.APIKey
			}
		}
		logs = append(logs, e)
	}
	return logs, total, nil
}

func GetChartData(days int) ([]ChartBucket, error) {
	var buckets []ChartBucket
	now := time.Now().UTC()
	startDate := now.AddDate(0, 0, -days).Format("2006-01-02")

	// Group daily
	rows, err := DB.Query(
		`SELECT dateKey, data FROM usageDaily WHERE dateKey >= ? ORDER BY dateKey ASC`,
		startDate,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var dateKey, dataStr string
		if err := rows.Scan(&dateKey, &dataStr); err != nil {
			return nil, err
		}
		var summary DailySummaryData
		_ = json.Unmarshal([]byte(dataStr), &summary)

		buckets = append(buckets, ChartBucket{
			Timestamp:        dateKey,
			Requests:         summary.Requests,
			PromptTokens:     summary.PromptTokens,
			CompletionTokens: summary.CompletionTokens,
			Cost:             math.Round(summary.Cost*1000) / 1000,
		})
	}
	return buckets, nil
}

type ModelUsageSummary struct {
	Model            string  `json:"model"`
	Provider         string  `json:"provider"`
	Requests         int     `json:"requests"`
	LastUsed         string  `json:"lastUsed"`
	PromptTokens     int     `json:"promptTokens"`
	CompletionTokens int     `json:"completionTokens"`
	CachedTokens     int     `json:"cachedTokens"`
	Cost             float64 `json:"cost"`
}

func GetModelUsageSummary(provider string, period string) ([]ModelUsageSummary, error) {
	where, args := BuildUsageWhere(provider, period)
	query := `
		SELECT 
			model, 
			COALESCE(provider, '') as provider,
			COUNT(*) as requests,
			MAX(timestamp) as lastUsed,
			SUM(promptTokens) as promptTokens,
			SUM(completionTokens) as completionTokens,
			COALESCE(SUM(cachedTokens), 0) as cachedTokens,
			SUM(cost) as cost
		FROM usageHistory` + where + " GROUP BY model, provider ORDER BY cost DESC"

	rows, err := DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var summaries []ModelUsageSummary
	for rows.Next() {
		var s ModelUsageSummary
		if err := rows.Scan(&s.Model, &s.Provider, &s.Requests, &s.LastUsed, &s.PromptTokens, &s.CompletionTokens, &s.CachedTokens, &s.Cost); err != nil {
			return nil, err
		}
		s.Cost = math.Round(s.Cost*10000) / 10000
		summaries = append(summaries, s)
	}
	return summaries, nil
}

type ProviderUsageSummary struct {
	Provider         string  `json:"provider"`
	Requests         int     `json:"requests"`
	PromptTokens     int     `json:"promptTokens"`
	CompletionTokens int     `json:"completionTokens"`
	CachedTokens     int     `json:"cachedTokens"`
	Cost             float64 `json:"cost"`
}

func GetProviderUsageSummary() ([]ProviderUsageSummary, error) {
	rows, err := DB.Query(`
		SELECT 
			COALESCE(provider, 'unknown') as provider,
			COUNT(*) as requests,
			SUM(promptTokens) as promptTokens,
			SUM(completionTokens) as completionTokens,
			COALESCE(SUM(cachedTokens), 0) as cachedTokens,
			SUM(cost) as cost
		FROM usageHistory
		GROUP BY provider
		ORDER BY cost DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var summaries []ProviderUsageSummary
	for rows.Next() {
		var s ProviderUsageSummary
		if err := rows.Scan(&s.Provider, &s.Requests, &s.PromptTokens, &s.CompletionTokens, &s.CachedTokens, &s.Cost); err != nil {
			return nil, err
		}
		s.Cost = math.Round(s.Cost*10000) / 10000
		summaries = append(summaries, s)
	}
	return summaries, nil
}

type MetricsOverview struct {
	Version         string                 `json:"version"`
	ExportedAt      string                 `json:"exportedAt"`
	TotalStats      *UsageStats            `json:"totalStats"`
	ProviderSummary []ProviderUsageSummary `json:"providerSummary"`
	ModelSummary    []ModelUsageSummary    `json:"modelSummary"`
}

func GetMetricsOverview() (*MetricsOverview, error) {
	stats, err := GetUsageStats("", "")
	if err != nil {
		return nil, err
	}
	provs, err := GetProviderUsageSummary()
	if err != nil {
		return nil, err
	}
	models, err := GetModelUsageSummary("", "")
	if err != nil {
		return nil, err
	}

	return &MetricsOverview{
		Version:         "1.0",
		ExportedAt:      time.Now().UTC().Format(time.RFC3339),
		TotalStats:      stats,
		ProviderSummary: provs,
		ModelSummary:    models,
	}, nil
}

func ImportMetricsOverview(overview *MetricsOverview) error {
	if overview == nil || (len(overview.ModelSummary) == 0 && len(overview.ProviderSummary) == 0) {
		return nil
	}

	nowStr := time.Now().UTC().Format(time.RFC3339)
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO usageHistory (
			timestamp, provider, model, connectionId, apiKey, endpoint,
			promptTokens, completionTokens, cachedTokens, cost, status, meta
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', '{}')
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	if len(overview.ModelSummary) > 0 {
		for _, m := range overview.ModelSummary {
			if m.Requests <= 0 && m.PromptTokens == 0 && m.CompletionTokens == 0 {
				continue
			}
			prov := m.Provider
			if prov == "" {
				prov = "imported"
			}
			modelName := m.Model
			if modelName == "" {
				modelName = "unknown"
			}
			_, err := stmt.Exec(
				nowStr,
				prov,
				modelName,
				"imported_sync",
				"sync",
				"/v1/synced_overview",
				m.PromptTokens,
				m.CompletionTokens,
				m.CachedTokens,
				m.Cost,
			)
			if err != nil {
				return err
			}
		}
	} else if len(overview.ProviderSummary) > 0 {
		for _, p := range overview.ProviderSummary {
			if p.Requests <= 0 && p.PromptTokens == 0 && p.CompletionTokens == 0 {
				continue
			}
			_, err := stmt.Exec(
				nowStr,
				p.Provider,
				"imported_summary",
				"imported_sync",
				"sync",
				"/v1/synced_overview",
				p.PromptTokens,
				p.CompletionTokens,
				p.CachedTokens,
				p.Cost,
			)
			if err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}
