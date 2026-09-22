package db

import (
	"encoding/json"
	"fmt"
	"time"
)

type ProviderNode struct {
	ID        string                 `json:"id"`
	Type      string                 `json:"type"`
	Name      string                 `json:"name"`
	Data      map[string]interface{} `json:"data"`
	CreatedAt string                 `json:"createdAt"`
	UpdatedAt string                 `json:"updatedAt"`
}

func CreateProviderNode(node *ProviderNode) (*ProviderNode, error) {
	now := time.Now().UTC().Format(time.RFC3339)

	// Check duplicate by id before insert (clearer error than PK violation)
	exists, err := nodeIDExists(node.ID)
	if err != nil {
		return nil, fmt.Errorf("checking duplicate node: %w", err)
	}
	if exists {
		return nil, fmt.Errorf("provider node %q already exists", node.ID)
	}

	node.CreatedAt = now
	node.UpdatedAt = now

	dataBytes, err := json.Marshal(node.Data)
	if err != nil {
		return nil, fmt.Errorf("marshalling data: %w", err)
	}

	_, err = DB.Exec(
		"INSERT INTO providerNodes (id, type, name, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
		node.ID, node.Type, node.Name, string(dataBytes), node.CreatedAt, node.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("inserting provider node: %w", err)
	}

	return node, nil
}

func ListProviderNodes() ([]ProviderNode, error) {
	rows, err := DB.Query("SELECT id, type, name, data, createdAt, updatedAt FROM providerNodes ORDER BY id ASC")
	if err != nil {
		return nil, fmt.Errorf("querying provider nodes: %w", err)
	}
	defer rows.Close()

	var list []ProviderNode
	for rows.Next() {
		var n ProviderNode
		var dataStr string
		err := rows.Scan(&n.ID, &n.Type, &n.Name, &dataStr, &n.CreatedAt, &n.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("scanning provider node: %w", err)
		}

		n.Data = make(map[string]interface{})
		_ = json.Unmarshal([]byte(dataStr), &n.Data)

		list = append(list, n)
	}

	return list, nil
}

func DeleteProviderNode(id string) error {
	_, err := DB.Exec("DELETE FROM providerNodes WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("deleting provider node: %w", err)
	}
	// Also delete any associated connections to make it clean
	_, _ = DB.Exec("DELETE FROM providerConnections WHERE provider = ?", id)
	return nil
}
