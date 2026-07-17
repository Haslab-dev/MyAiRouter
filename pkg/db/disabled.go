package db

import (
	"encoding/json"
	"fmt"
)

const DisabledModelsScope = "disabledModels"
const EnabledModelsScope = "enabledModels"

func GetDisabledModels(provider string) ([]string, error) {
	var val string
	err := DB.QueryRow(
		"SELECT value FROM kv WHERE scope = ? AND key = ?",
		DisabledModelsScope, provider,
	).Scan(&val)
	if err != nil {
		return []string{}, nil
	}
	var ids []string
	if err := json.Unmarshal([]byte(val), &ids); err != nil {
		return nil, fmt.Errorf("unmarshalling disabled models: %w", err)
	}
	return ids, nil
}

func DisableModels(provider string, ids []string) error {
	current, err := GetDisabledModels(provider)
	if err != nil {
		current = []string{}
	}
	uniqueMap := make(map[string]bool)
	for _, id := range current {
		uniqueMap[id] = true
	}
	for _, id := range ids {
		uniqueMap[id] = true
	}
	var merged []string
	for id := range uniqueMap {
		merged = append(merged, id)
	}
	valBytes, err := json.Marshal(merged)
	if err != nil {
		return err
	}
	_, err = DB.Exec(
		`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) 
		 ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
		DisabledModelsScope, provider, string(valBytes),
	)
	return err
}

func EnableModels(provider string, ids []string) error {
	if len(ids) == 0 {
		_, err := DB.Exec("DELETE FROM kv WHERE scope = ? AND key = ?", DisabledModelsScope, provider)
		return err
	}
	current, err := GetDisabledModels(provider)
	if err != nil {
		return err
	}
	removeMap := make(map[string]bool)
	for _, id := range ids {
		removeMap[id] = true
	}
	var next []string
	for _, id := range current {
		if !removeMap[id] {
			next = append(next, id)
		}
	}
	if len(next) == 0 {
		_, err := DB.Exec("DELETE FROM kv WHERE scope = ? AND key = ?", DisabledModelsScope, provider)
		return err
	}
	valBytes, err := json.Marshal(next)
	if err != nil {
		return err
	}
	_, err = DB.Exec(
		`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) 
		 ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
		DisabledModelsScope, provider, string(valBytes),
	)
	return err
}

// Whitelist: enabled models. If list is non-empty, only these model IDs are allowed.
func GetEnabledModels(provider string) ([]string, error) {
	var val string
	err := DB.QueryRow(
		"SELECT value FROM kv WHERE scope = ? AND key = ?",
		EnabledModelsScope, provider,
	).Scan(&val)
	if err != nil {
		return nil, nil // nil means "all allowed"
	}
	var ids []string
	if err := json.Unmarshal([]byte(val), &ids); err != nil {
		return nil, fmt.Errorf("unmarshalling enabled models: %w", err)
	}
	return ids, nil
}

func SetEnabledModels(provider string, ids []string) error {
	valBytes, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	_, err = DB.Exec(
		`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) 
		 ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
		EnabledModelsScope, provider, string(valBytes),
	)
	return err
}
