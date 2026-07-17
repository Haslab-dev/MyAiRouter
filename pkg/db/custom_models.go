package db

import (
	"encoding/json"
	"fmt"
)

const CustomModelsScope = "customModels"

type CustomModel struct {
	ProviderAlias string `json:"providerAlias"`
	ID            string `json:"id"`
	Type          string `json:"type"`
	Name          string `json:"name"`
}

func customKey(providerAlias, id, modelType string) string {
	return fmt.Sprintf("%s|%s|%s", providerAlias, id, modelType)
}

func GetCustomModels() ([]CustomModel, error) {
	rows, err := DB.Query("SELECT value FROM kv WHERE scope = ?", CustomModelsScope)
	if err != nil {
		return nil, fmt.Errorf("querying custom models: %w", err)
	}
	defer rows.Close()

	var list []CustomModel
	for rows.Next() {
		var val string
		if err := rows.Scan(&val); err != nil {
			return nil, err
		}
		var cm CustomModel
		if err := json.Unmarshal([]byte(val), &cm); err == nil {
			list = append(list, cm)
		}
	}
	return list, nil
}

func AddCustomModel(cm *CustomModel) (bool, error) {
	k := customKey(cm.ProviderAlias, cm.ID, cm.Type)

	var exists int
	err := DB.QueryRow("SELECT 1 FROM kv WHERE scope = ? AND key = ?", CustomModelsScope, k).Scan(&exists)
	if err == nil {
		// Already exists
		return false, nil
	}

	valBytes, err := json.Marshal(cm)
	if err != nil {
		return false, err
	}

	_, err = DB.Exec(
		"INSERT INTO kv (scope, key, value) VALUES (?, ?, ?)",
		CustomModelsScope, k, string(valBytes),
	)
	if err != nil {
		return false, err
	}

	return true, nil
}

func GetCustomModelsByProvider(providerAlias string) ([]CustomModel, error) {
	all, err := GetCustomModels()
	if err != nil {
		return nil, err
	}
	var filtered []CustomModel
	for _, cm := range all {
		if cm.ProviderAlias == providerAlias {
			filtered = append(filtered, cm)
		}
	}
	return filtered, nil
}

func DeleteCustomModel(providerAlias, id, modelType string) error {
	k := customKey(providerAlias, id, modelType)
	_, err := DB.Exec("DELETE FROM kv WHERE scope = ? AND key = ?", CustomModelsScope, k)
	return err
}
