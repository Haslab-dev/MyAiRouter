package db

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type ApiKey struct {
	ID        string `json:"id"`
	Key       string `json:"key"`
	Name      string `json:"name"`
	MachineID string `json:"machineId"`
	IsActive  bool   `json:"isActive"`
	CreatedAt string `json:"createdAt"`
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
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}

	_, err = DB.Exec(
		"INSERT INTO apiKeys (id, key, name, machineId, isActive, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
		key.ID, key.Key, key.Name, key.MachineID, 1, key.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	return key, nil
}

func ListApiKeys() ([]ApiKey, error) {
	rows, err := DB.Query("SELECT id, key, name, machineId, isActive, createdAt FROM apiKeys ORDER BY createdAt DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []ApiKey
	for rows.Next() {
		var k ApiKey
		var active int
		if err := rows.Scan(&k.ID, &k.Key, &k.Name, &k.MachineID, &active, &k.CreatedAt); err != nil {
			return nil, err
		}
		k.IsActive = active == 1
		keys = append(keys, k)
	}
	return keys, nil
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
