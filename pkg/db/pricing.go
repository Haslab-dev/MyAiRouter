package db

import (
	"encoding/json"
	"fmt"
	"strings"
)

const PricingOverridesScope = "pricingOverrides"

type PricingOverrideRecord struct {
	Provider string  `json:"provider"`
	Model    string  `json:"model"`
	Input    float64 `json:"input"`
	Output   float64 `json:"output"`
	Cached   float64 `json:"cached"`
}

func pricingKey(provider, model string) string {
	p := strings.ToLower(strings.TrimSpace(provider))
	m := strings.ToLower(strings.TrimSpace(model))
	if idx := strings.LastIndex(m, "/"); idx != -1 {
		m = m[idx+1:]
	}
	if p != "" {
		return fmt.Sprintf("%s:%s", p, m)
	}
	return m
}

func GetPricingOverrides(provider string) (map[string]ModelRate, error) {
	rows, err := DB.Query("SELECT key, value FROM kv WHERE scope = ?", PricingOverridesScope)
	if err != nil {
		return nil, fmt.Errorf("querying pricing overrides: %w", err)
	}
	defer rows.Close()

	p := strings.ToLower(strings.TrimSpace(provider))
	res := make(map[string]ModelRate)
	for rows.Next() {
		var k, val string
		if err := rows.Scan(&k, &val); err != nil {
			return nil, err
		}
		var rec PricingOverrideRecord
		if err := json.Unmarshal([]byte(val), &rec); err == nil {
			rate := ModelRate{
				Input:  rec.Input,
				Output: rec.Output,
				Cached: rec.Cached,
			}
			// Match if no provider requested or provider matches
			if p == "" || strings.ToLower(rec.Provider) == p || k == rec.Model || strings.HasPrefix(k, p+":") {
				res[rec.Model] = rate
				if rec.Provider != "" {
					res[rec.Provider+"/"+rec.Model] = rate
				}
			}
		}
	}
	return res, nil
}

func GetPricingOverride(provider, model string) (ModelRate, bool) {
	p := strings.ToLower(strings.TrimSpace(provider))
	m := strings.ToLower(strings.TrimSpace(model))
	baseModel := m
	if idx := strings.LastIndex(m, "/"); idx != -1 {
		if p == "" {
			p = m[:idx]
		}
		baseModel = m[idx+1:]
	}

	keysToTry := []string{}
	if p != "" {
		keysToTry = append(keysToTry, fmt.Sprintf("%s:%s", p, baseModel), fmt.Sprintf("%s:%s", p, m))
	}
	keysToTry = append(keysToTry, baseModel, m)

	for _, k := range keysToTry {
		var val string
		err := DB.QueryRow("SELECT value FROM kv WHERE scope = ? AND key = ?", PricingOverridesScope, k).Scan(&val)
		if err == nil {
			var rec PricingOverrideRecord
			if err := json.Unmarshal([]byte(val), &rec); err == nil {
				return ModelRate{
					Input:  rec.Input,
					Output: rec.Output,
					Cached: rec.Cached,
				}, true
			}
		}
	}
	return ModelRate{}, false
}

func SetPricingOverride(provider, model string, rate ModelRate) error {
	p := strings.ToLower(strings.TrimSpace(provider))
	m := strings.TrimSpace(model)
	if idx := strings.LastIndex(m, "/"); idx != -1 {
		if p == "" {
			p = m[:idx]
		}
		m = m[idx+1:]
	}

	k := pricingKey(p, m)
	rec := PricingOverrideRecord{
		Provider: p,
		Model:    m,
		Input:    rate.Input,
		Output:   rate.Output,
		Cached:   rate.Cached,
	}

	valBytes, err := json.Marshal(rec)
	if err != nil {
		return err
	}

	_, err = DB.Exec(
		`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) 
		 ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
		PricingOverridesScope, k, string(valBytes),
	)
	return err
}

func DeletePricingOverride(provider, model string) error {
	p := strings.ToLower(strings.TrimSpace(provider))
	m := strings.TrimSpace(model)
	if idx := strings.LastIndex(m, "/"); idx != -1 {
		if p == "" {
			p = m[:idx]
		}
		m = m[idx+1:]
	}

	k := pricingKey(p, m)
	_, err := DB.Exec("DELETE FROM kv WHERE scope = ? AND key = ?", PricingOverridesScope, k)
	if err != nil {
		return err
	}
	// Also delete un-prefixed key if present
	_, _ = DB.Exec("DELETE FROM kv WHERE scope = ? AND key = ?", PricingOverridesScope, m)
	return nil
}
