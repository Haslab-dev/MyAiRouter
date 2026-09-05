package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

func InitDB() error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("getting home dir: %w", err)
	}

	appDir := filepath.Join(homeDir, ".myairouter")
	if err := os.MkdirAll(appDir, 0755); err != nil {
		return fmt.Errorf("creating app directory: %w", err)
	}

	dbPath := filepath.Join(appDir, "db.sqlite")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("opening sqlite DB: %w", err)
	}

	// Allow concurrent reads with WAL mode
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)

	// Optimize SQLite performance & RAM footprint
	pragmas := []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA synchronous = NORMAL;",
		"PRAGMA temp_store = DEFAULT;",
		"PRAGMA busy_timeout = 10000;",
		"PRAGMA foreign_keys = ON;",
		"PRAGMA cache_size = -4000;", // 4MB page cache instead of 64MB (-64000)
		"PRAGMA mmap_size = 0;",      // Disable mmap allocations in c2go
	}
	for _, pragma := range pragmas {
		if _, err := db.Exec(pragma); err != nil {
			_ = err // WAL may not be supported by pure-Go sqlite, ignore
		}
	}

	DB = db

	if err := createTables(); err != nil {
		return fmt.Errorf("creating tables: %w", err)
	}

	return nil
}

func createTables() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS settings (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			data TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS providerConnections (
			id TEXT PRIMARY KEY,
			provider TEXT NOT NULL,
			authType TEXT NOT NULL,
			name TEXT,
			email TEXT,
			priority INTEGER,
			isActive INTEGER DEFAULT 1,
			data TEXT NOT NULL,
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider);`,
		`CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive);`,
		`CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority);`,

		`CREATE TABLE IF NOT EXISTS apiKeys (
			id TEXT PRIMARY KEY,
			key TEXT UNIQUE NOT NULL,
			name TEXT,
			machineId TEXT,
			isActive INTEGER DEFAULT 1,
			createdAt TEXT NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key);`,

		`CREATE TABLE IF NOT EXISTS providerNodes (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			name TEXT NOT NULL,
			data TEXT NOT NULL,
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type);`,

		`CREATE TABLE IF NOT EXISTS combos (
			id TEXT PRIMARY KEY,
			name TEXT UNIQUE NOT NULL,
			kind TEXT,
			models TEXT NOT NULL,
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name);`,

		`CREATE TABLE IF NOT EXISTS kv (
			scope TEXT NOT NULL,
			key TEXT NOT NULL,
			value TEXT NOT NULL,
			PRIMARY KEY (scope, key)
		);`,
		`CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope);`,

		`CREATE TABLE IF NOT EXISTS usageHistory (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp TEXT NOT NULL,
			provider TEXT,
			model TEXT,
			connectionId TEXT,
			apiKey TEXT,
			endpoint TEXT,
			promptTokens INTEGER DEFAULT 0,
			completionTokens INTEGER DEFAULT 0,
			cost REAL DEFAULT 0,
			status TEXT,
			tokens TEXT,
			meta TEXT
		);`,
		`CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider);`,
		`CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model);`,
		`CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId);`,

		`CREATE TABLE IF NOT EXISTS usageDaily (
			dateKey TEXT PRIMARY KEY,
			data TEXT NOT NULL
		);`,

		// New flat traces table — typed columns & structured JSON fields
		`CREATE TABLE IF NOT EXISTS traces (
			id TEXT PRIMARY KEY,
			timestamp TEXT NOT NULL,
			status TEXT DEFAULT 'ok',
			provider TEXT,
			model TEXT,
			route TEXT DEFAULT 'direct',
			node TEXT,
			routeNodes TEXT,
			attempt INTEGER DEFAULT 1,
			totalAttempts INTEGER DEFAULT 1,
			latencyMs INTEGER DEFAULT 0,
			ttfbMs INTEGER DEFAULT 0,
			inputTokens INTEGER DEFAULT 0,
			outputTokens INTEGER DEFAULT 0,
			cachedTokens INTEGER DEFAULT 0,
			compression INTEGER DEFAULT 0,
			cache TEXT DEFAULT 'bypass',
			cost REAL DEFAULT 0,
			isStream INTEGER DEFAULT 0,
			retryCount INTEGER DEFAULT 0,
			fallbackCount INTEGER DEFAULT 0,
			targetAttempts TEXT,
			pipeline TEXT,
			requestMeta TEXT,
			responseMeta TEXT,
			request TEXT,
			response TEXT
		);`,
		`CREATE INDEX IF NOT EXISTS idx_traces_ts ON traces(timestamp DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_traces_provider ON traces(provider);`,
		`CREATE INDEX IF NOT EXISTS idx_traces_model ON traces(model);`,

		// Session & Memory Store tables were removed: the gateway is a plain
		// pass-through; caching belongs to the calling client/agent tools.

		// Model-Centric Routing & Configuration table
		`CREATE TABLE IF NOT EXISTS models (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			primary_provider TEXT NOT NULL,
			fallback_provider TEXT,
			fallback_model TEXT,
			compression_enabled INTEGER DEFAULT 0,
			compression_strategy TEXT DEFAULT 'balanced',
			compression_trigger TEXT DEFAULT 'threshold',
			compression_threshold INTEGER DEFAULT 64000,
			preserve_recent_messages INTEGER DEFAULT 20,
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL
		);`,

		// Chat Sessions with JSONL streaming append storage
		`CREATE TABLE IF NOT EXISTS chatSessions (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			model TEXT,
			systemPrompt TEXT,
			messageCount INTEGER DEFAULT 0,
			filePath TEXT,
			createdAt TEXT NOT NULL,
			updatedAt TEXT NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_chatsessions_updated ON chatSessions(updatedAt DESC);`,
	}

	for _, query := range queries {
		if _, err := DB.Exec(query); err != nil {
			return err
		}
	}

	// Migrations: add columns that may not exist in older schemas
	migrations := []string{
		"ALTER TABLE usageHistory ADD COLUMN cachedTokens INTEGER DEFAULT 0;",
		"ALTER TABLE models ADD COLUMN compression_trigger TEXT DEFAULT 'threshold';",
		"ALTER TABLE models ADD COLUMN fallback_model TEXT;",
		"ALTER TABLE combos ADD COLUMN policy TEXT;",
		// Gateway cache/content-dedup removal (pass-through by default)
		"DROP TABLE IF EXISTS contentCache;",
		"DROP TABLE IF EXISTS sessions;",
		"DELETE FROM kv WHERE scope = 'cache';",
	}
	for _, m := range migrations {
		_, _ = DB.Exec(m) // Ignore errors — column may already exist
	}

	if err := RunMigrations(); err != nil {
		return fmt.Errorf("running dedup migrations: %w", err)
	}

	// Insert default settings if not exists
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM settings WHERE id = 1").Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		defaultSettingsJSON := `{"rtkEnabled":false,"headroomEnabled":false,"headroomUrl":"http://localhost:8787","cavemanEnabled":false,"cavemanLevel":"full","ponytailEnabled":false,"ponytailLevel":"full","optimizerEnabled":false,"optimizationEngine":"auto","optimizationProfile":"balanced","optimizationGoal":"balanced","pipelineSteps":[{"name":"tool","enabled":true},{"name":"structure","enabled":true},{"name":"dedup","enabled":true},{"name":"markdown","enabled":true}],"traceStorageMode":"summary"}`
		_, err = DB.Exec("INSERT INTO settings (id, data) VALUES (1, ?)", defaultSettingsJSON)
		if err != nil {
			return err
		}
	}

	return nil
}
