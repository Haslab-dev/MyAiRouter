package db

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
)

type columnSpec struct {
	table   string
	column  string
	colType string
}

func RunMigrations() error {
	if err := ensureSchemaColumns(); err != nil {
		log.Printf("[migration] warning checking schema columns: %v", err)
	}

	if err := ensureSchemaIndexes(); err != nil {
		log.Printf("[migration] warning checking schema indexes: %v", err)
	}

	if err := migrateSettingsSchema(); err != nil {
		log.Printf("[migration] warning migrating settings schema: %v", err)
	}

	if err := deduplicateConnections(); err != nil {
		return fmt.Errorf("dedup connections: %w", err)
	}
	if err := deduplicateProviderNodes(); err != nil {
		return fmt.Errorf("dedup provider nodes: %w", err)
	}

	if err := purgeLegacyTraces(); err != nil {
		log.Printf("[migration] warning purging legacy requestDetails: %v", err)
	}
	return nil
}

func purgeLegacyTraces() error {
	// Purge existing heavy trace entries from requestDetails to free RAM and database storage
	res, err := DB.Exec("DELETE FROM requestDetails;")
	if err == nil {
		if rows, _ := res.RowsAffected(); rows > 0 {
			log.Printf("[migration] purged %d legacy heavy trace entries for lightweight tracer upgrade", rows)
		}
	}
	return nil
}

func ensureSchemaColumns() error {
	requiredColumns := []columnSpec{
		// usageHistory
		{"usageHistory", "cachedTokens", "INTEGER DEFAULT 0"},
		{"usageHistory", "cost", "REAL DEFAULT 0"},
		{"usageHistory", "promptTokens", "INTEGER DEFAULT 0"},
		{"usageHistory", "completionTokens", "INTEGER DEFAULT 0"},
		{"usageHistory", "connectionId", "TEXT"},
		{"usageHistory", "provider", "TEXT"},
		{"usageHistory", "model", "TEXT"},
		{"usageHistory", "status", "TEXT"},
		{"usageHistory", "tokens", "TEXT"},
		{"usageHistory", "meta", "TEXT"},

		// providerConnections
		{"providerConnections", "isActive", "INTEGER DEFAULT 1"},
		{"providerConnections", "priority", "INTEGER DEFAULT 1"},
		{"providerConnections", "authType", "TEXT DEFAULT 'apikey'"},
		{"providerConnections", "name", "TEXT"},
		{"providerConnections", "email", "TEXT"},

		// apiKeys
		{"apiKeys", "isActive", "INTEGER DEFAULT 1"},
		{"apiKeys", "machineId", "TEXT"},

		// combos
		{"combos", "kind", "TEXT"},
	}

	for _, spec := range requiredColumns {
		hasCol, err := columnExists(spec.table, spec.column)
		if err != nil {
			continue
		}
		if !hasCol {
			alterQuery := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s;", spec.table, spec.column, spec.colType)
			if _, err := DB.Exec(alterQuery); err != nil {
				log.Printf("[migration] failed to add column %s to %s: %v", spec.column, spec.table, err)
			} else {
				log.Printf("[migration] seamlessly added column '%s' to table '%s'", spec.column, spec.table)
			}
		}
	}
	return nil
}

func columnExists(tableName, columnName string) (bool, error) {
	rows, err := DB.Query(fmt.Sprintf("PRAGMA table_info(%s)", tableName))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dfltValue interface{}
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltValue, &pk); err != nil {
			continue
		}
		if strings.EqualFold(name, columnName) {
			return true, nil
		}
	}
	return false, nil
}

func ensureSchemaIndexes() error {
	indexes := []string{
		"CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC);",
		"CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider);",
		"CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model);",
		"CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId);",
		"CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider);",
		"CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive);",
		"CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority);",
		"CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key);",
		"CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type);",
		"CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name);",
		"CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope);",
		"CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC);",
	}

	for _, idxQuery := range indexes {
		_, _ = DB.Exec(idxQuery)
	}
	return nil
}

func migrateSettingsSchema() error {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM settings WHERE id = 1").Scan(&count)
	if err != nil || count == 0 {
		return nil
	}

	// Trigger GetSettings which applies default dynamic fallbacks
	settings, err := GetSettings()
	if err != nil {
		return err
	}

	// Save back to ensure DB contains all latest keys seamlessly
	settingsBytes, err := json.Marshal(settings)
	if err != nil {
		return err
	}

	_, err = DB.Exec("UPDATE settings SET data = ? WHERE id = 1", string(settingsBytes))
	return err
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
