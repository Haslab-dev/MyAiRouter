package db

import (
	"encoding/json"
	"fmt"
	"log"
)

func RunMigrations() error {
	if err := deduplicateConnections(); err != nil {
		return fmt.Errorf("dedup connections: %w", err)
	}
	if err := deduplicateProviderNodes(); err != nil {
		return fmt.Errorf("dedup provider nodes: %w", err)
	}
	return nil
}

func deduplicateConnections() error {
	conns, err := ListConnections()
	if err != nil {
		return err
	}

	type key struct {
		provider string
		apiKey   string
	}
	seen := make(map[key]string)
	removed := 0

	for _, c := range conns {
		apiKey, _ := c.Data["apiKey"].(string)
		k := key{provider: c.Provider, apiKey: apiKey}
		if firstID, ok := seen[k]; ok {
			// Keep connection with lowest priority, then earliest created
			var first ProviderConnection
			if err := DB.QueryRow("SELECT priority, createdAt FROM providerConnections WHERE id = ?", firstID).Scan(&first.Priority, &first.CreatedAt); err != nil {
				continue
			}
			if c.Priority < first.Priority || (c.Priority == first.Priority && c.CreatedAt < first.CreatedAt) {
				_, _ = DB.Exec("DELETE FROM providerConnections WHERE id = ?", firstID)
				seen[k] = c.ID
			} else {
				_, _ = DB.Exec("DELETE FROM providerConnections WHERE id = ?", c.ID)
			}
			removed++
		} else {
			seen[k] = c.ID
		}
	}

	if removed > 0 {
		log.Printf("[migration] removed %d duplicate provider connection(s)", removed)
	}
	return nil
}

func deduplicateProviderNodes() error {
	rows, err := DB.Query("SELECT id, type, name, data, createdAt FROM providerNodes ORDER BY createdAt ASC")
	if err != nil {
		return err
	}
	defer rows.Close()

	type nodeKey struct {
		nodeType string
		name     string
	}
	seen := make(map[nodeKey]bool)
	var toDelete []string

	for rows.Next() {
		var id, nodeType, name, createdAt string
		var dataStr string
		if err := rows.Scan(&id, &nodeType, &name, &dataStr, &createdAt); err != nil {
			continue
		}
		k := nodeKey{nodeType: nodeType, name: name}
		if seen[k] {
			toDelete = append(toDelete, id)
		} else {
			seen[k] = true
		}
	}

	for _, id := range toDelete {
		var count int
		_ = DB.QueryRow("SELECT COUNT(*) FROM providerConnections WHERE provider = ?", id).Scan(&count)
		if count == 0 {
			_, _ = DB.Exec("DELETE FROM providerNodes WHERE id = ?", id)
			log.Printf("[migration] removed duplicate provider node: %s", id)
		}
	}

	return nil
}

func connectionExists(provider, apiKey string) (bool, error) {
	rows, err := DB.Query("SELECT data FROM providerConnections WHERE provider = ?", provider)
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var dataStr string
		if err := rows.Scan(&dataStr); err != nil {
			continue
		}
		var data map[string]interface{}
		if err := json.Unmarshal([]byte(dataStr), &data); err != nil {
			continue
		}
		if key, ok := data["apiKey"].(string); ok && key == apiKey {
			return true, nil
		}
	}
	return false, nil
}

func nodeIDExists(id string) (bool, error) {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM providerNodes WHERE id = ?", id).Scan(&count)
	return count > 0, err
}
