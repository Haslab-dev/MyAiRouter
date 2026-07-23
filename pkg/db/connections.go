package db

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type ProviderConnection struct {
	ID        string                 `json:"id"`
	Provider  string                 `json:"provider"`
	AuthType  string                 `json:"authType"`
	Name      string                 `json:"name"`
	Email     string                 `json:"email"`
	Priority  int                    `json:"priority"`
	IsActive  bool                   `json:"isActive"`
	Data      map[string]interface{} `json:"data"` // Parsed from/serialized to 'data' text column
	CreatedAt string                 `json:"createdAt"`
	UpdatedAt string                 `json:"updatedAt"`
}

func CreateConnection(conn *ProviderConnection) (*ProviderConnection, error) {
	if conn.ID == "" {
		conn.ID = uuid.New().String()
	}
	// Prevent duplicate: same provider + same apiKey
	if apiKey, ok := conn.Data["apiKey"].(string); ok && apiKey != "" {
		exists, err := connectionExists(conn.Provider, apiKey)
		if err != nil {
			return nil, fmt.Errorf("checking duplicate connection: %w", err)
		}
		if exists {
			return nil, fmt.Errorf("connection already exists for provider %q with this API key", conn.Provider)
		}
	}

	conn.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	conn.UpdatedAt = conn.CreatedAt

	dataBytes, err := json.Marshal(conn.Data)
	if err != nil {
		return nil, fmt.Errorf("marshalling custom data: %w", err)
	}

	activeVal := 0
	if conn.IsActive {
		activeVal = 1
	}

	_, err = DB.Exec(
		`INSERT INTO providerConnections (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) 
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		conn.ID, conn.Provider, conn.AuthType, conn.Name, conn.Email, conn.Priority, activeVal, string(dataBytes), conn.CreatedAt, conn.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	return conn, nil
}

func ListConnections() ([]ProviderConnection, error) {
	rows, err := DB.Query("SELECT id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt FROM providerConnections ORDER BY provider, priority")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var conns []ProviderConnection
	for rows.Next() {
		var c ProviderConnection
		var active int
		var dataStr string
		if err := rows.Scan(&c.ID, &c.Provider, &c.AuthType, &c.Name, &c.Email, &c.Priority, &active, &dataStr, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		c.IsActive = active == 1
		c.Data = make(map[string]interface{})
		_ = json.Unmarshal([]byte(dataStr), &c.Data)
		conns = append(conns, c)
	}
	return conns, nil
}

func GetConnection(id string) (*ProviderConnection, error) {
	var c ProviderConnection
	var active int
	var dataStr string
	err := DB.QueryRow(
		"SELECT id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt FROM providerConnections WHERE id = ?", id,
	).Scan(&c.ID, &c.Provider, &c.AuthType, &c.Name, &c.Email, &c.Priority, &active, &dataStr, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	c.IsActive = active == 1
	c.Data = make(map[string]interface{})
	_ = json.Unmarshal([]byte(dataStr), &c.Data)
	return &c, nil
}

func UpdateConnection(id string, updates map[string]interface{}) (*ProviderConnection, error) {
	current, err := GetConnection(id)
	if err != nil {
		return nil, err
	}

	if val, ok := updates["name"].(string); ok {
		current.Name = val
	}
	if val, ok := updates["email"].(string); ok {
		current.Email = val
	}
	if val, ok := updates["priority"].(float64); ok {
		current.Priority = int(val)
	} else if val, ok := updates["priority"].(int); ok {
		current.Priority = val
	}
	if val, ok := updates["isActive"].(bool); ok {
		current.IsActive = val
	}

	// Update custom data field
	if customData, ok := updates["data"].(map[string]interface{}); ok {
		for k, v := range customData {
			current.Data[k] = v
		}
	} else {
		// Merge any other fields that are in updates but not Connection top-level fields
		topLevel := map[string]bool{"id": true, "provider": true, "authType": true, "name": true, "email": true, "priority": true, "isActive": true, "data": true, "createdAt": true, "updatedAt": true}
		for k, v := range updates {
			if !topLevel[k] {
				current.Data[k] = v
			}
		}
	}

	current.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	dataBytes, _ := json.Marshal(current.Data)
	activeVal := 0
	if current.IsActive {
		activeVal = 1
	}

	_, err = DB.Exec(
		"UPDATE providerConnections SET name = ?, email = ?, priority = ?, isActive = ?, data = ?, updatedAt = ? WHERE id = ?",
		current.Name, current.Email, current.Priority, activeVal, string(dataBytes), current.UpdatedAt, id,
	)
	if err != nil {
		return nil, err
	}

	return current, nil
}

func DeleteConnection(id string) error {
	_, err := DB.Exec("DELETE FROM providerConnections WHERE id = ? OR provider = ?", id, id)
	return err
}

func GetActiveConnectionsForProvider(provider string) ([]ProviderConnection, error) {
	rows, err := DB.Query(
		"SELECT id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt FROM providerConnections WHERE provider = ? AND isActive = 1 ORDER BY priority ASC, id ASC",
		provider,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var conns []ProviderConnection
	for rows.Next() {
		var c ProviderConnection
		var active int
		var dataStr string
		if err := rows.Scan(&c.ID, &c.Provider, &c.AuthType, &c.Name, &c.Email, &c.Priority, &active, &dataStr, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		c.IsActive = active == 1
		c.Data = make(map[string]interface{})
		_ = json.Unmarshal([]byte(dataStr), &c.Data)
		conns = append(conns, c)
	}
	return conns, nil
}
