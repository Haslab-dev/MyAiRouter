package db

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ApiKeyScope constrains what a key may do. Zero value = unrestricted, so
// every key created before scoping existed keeps working unchanged.
type ApiKeyScope struct {
	// AllowedModels: optional allowlist of model IDs / combo names. Empty = all.
	AllowedModels []string `json:"allowedModels,omitempty"`
	// DailyTokenLimit: cap on tokens (prompt+completion) per UTC day. 0 = unlimited.
	DailyTokenLimit int64 `json:"dailyTokenLimit,omitempty"`
}

type ApiKey struct {
	ID        string      `json:"id"`
	Key       string      `json:"key"`
	Name      string      `json:"name"`
	MachineID string      `json:"machineId"`
	IsActive  bool        `json:"isActive"`
	Scope     ApiKeyScope `json:"scope"`
	CreatedAt string      `json:"createdAt"`
}

func GenerateKeyString() (string, error) {
	bytes := make([]byte, 24)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "sk-" + hex.EncodeToString(bytes), nil
}

func CreateApiKey(name string) (*ApiKey, error) {
	keyStr, err := GenerateKeyString()
	if err != nil {
		return nil, fmt.Errorf("generating key string: %w", err)
	}

	key := &ApiKey{
		ID:        uuid.New().String(),
		Key:       keyStr,
		Name:      name,
		MachineID: "",
		IsActive:  true,
		Scope:     ApiKeyScope{},
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}

	_, err = DB.Exec(
		"INSERT INTO apiKeys (id, key, name, machineId, isActive, scope, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
		key.ID, key.Key, key.Name, key.MachineID, 1, encodeScope(key.Scope), key.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	return key, nil
}

func ListApiKeys() ([]ApiKey, error) {
	rows, err := DB.Query("SELECT id, key, name, machineId, isActive, COALESCE(scope, ''), createdAt FROM apiKeys ORDER BY createdAt DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []ApiKey
	for rows.Next() {
		var k ApiKey
		var active int
		var scopeStr string
		if err := rows.Scan(&k.ID, &k.Key, &k.Name, &k.MachineID, &active, &scopeStr, &k.CreatedAt); err != nil {
			return nil, err
		}
		k.IsActive = active == 1
		k.Scope = decodeScope(scopeStr)
		keys = append(keys, k)
	}
	return keys, nil
}

// UpdateApiKeyScope replaces a key's scope (allowlist + daily token cap).
func UpdateApiKeyScope(id string, scope ApiKeyScope) error {
	_, err := DB.Exec("UPDATE apiKeys SET scope = ? WHERE id = ?", encodeScope(scope), id)
	return err
}

// FindApiKeyByValue returns the key record for a raw key string.
func FindApiKeyByValue(keyStr string) (*ApiKey, error) {
	var k ApiKey
	var active int
	var scopeStr string
	err := DB.QueryRow(
		"SELECT id, key, name, machineId, isActive, COALESCE(scope, ''), createdAt FROM apiKeys WHERE key = ?",
		keyStr,
	).Scan(&k.ID, &k.Key, &k.Name, &k.MachineID, &active, &scopeStr, &k.CreatedAt)
	if err != nil {
		return nil, err
	}
	k.IsActive = active == 1
	k.Scope = decodeScope(scopeStr)
	return &k, nil
}

// ModelAllowed reports whether the key may call the given model or combo name.
// An empty allowlist permits everything.
func (k *ApiKey) ModelAllowed(model string) bool {
	if k == nil || len(k.Scope.AllowedModels) == 0 {
		return true
	}
	for _, m := range k.Scope.AllowedModels {
		if m == model {
			return true
		}
	}
	return false
}

// TokensUsedToday returns prompt+completion tokens this key consumed since the
// UTC day started, summed from the usage log. Usage rows record the raw key
// in their apiKey column; the joined lookup is done via this key's hash-safe
// equality on the key string.
func TokensUsedToday(keyValue string) int64 {
	var total int64
	start := time.Now().UTC().Truncate(24 * time.Hour).Format(time.RFC3339)
	_ = DB.QueryRow(
		"SELECT COALESCE(SUM(promptTokens + completionTokens), 0) FROM usageHistory WHERE apiKey = ? AND timestamp >= ?",
		keyValue, start,
	).Scan(&total)
	return total
}

// DailyLimitExceeded reports whether the key is over its daily token budget.
func (k *ApiKey) DailyLimitExceeded() bool {
	if k == nil || k.Scope.DailyTokenLimit <= 0 {
		return false
	}
	return TokensUsedToday(k.Key) >= k.Scope.DailyTokenLimit
}

func encodeScope(s ApiKeyScope) string {
	raw, err := json.Marshal(s)
	if err != nil {
		return ""
	}
	return string(raw)
}

func decodeScope(raw string) ApiKeyScope {
	var s ApiKeyScope
	if raw == "" {
		return s
	}
	_ = json.Unmarshal([]byte(raw), &s)
	return s
}

func ToggleApiKey(id string, active bool) error {
	val := 0
	if active {
		val = 1
	}
	_, err := DB.Exec("UPDATE apiKeys SET isActive = ? WHERE id = ?", val, id)
	return err
}

func DeleteApiKey(id string) error {
	_, err := DB.Exec("DELETE FROM apiKeys WHERE id = ?", id)
	return err
}

func ValidateApiKey(keyStr string) (bool, error) {
	var active int
	err := DB.QueryRow("SELECT isActive FROM apiKeys WHERE key = ?", keyStr).Scan(&active)
	if err != nil {
		return false, nil // Invalid key or DB error
	}
	return active == 1, nil
}
