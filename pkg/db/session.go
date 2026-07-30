package db

import (
	"database/sql"
	"time"
)

type SessionEntry struct {
	ID        string `json:"id"`
	Workspace string `json:"workspace"`
	Summary   string `json:"summary"`
	UpdatedAt string `json:"updatedAt"`
}

type ContentCacheEntry struct {
	Hash      string `json:"hash"`
	FilePath  string `json:"filePath"`
	Summary   string `json:"summary"`
	Tokens    int    `json:"tokens"`
	UpdatedAt string `json:"updatedAt"`
}

func SaveDBSession(id, workspace, summary string) error {
	updatedAt := time.Now().UTC().Format(time.RFC3339)
	_, err := DB.Exec(`
		INSERT INTO sessions (id, workspace, summary, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			workspace = excluded.workspace,
			summary = excluded.summary,
			updated_at = excluded.updated_at`,
		id, workspace, summary, updatedAt,
	)
	return err
}

func GetDBSession(id string) (*SessionEntry, error) {
	var s SessionEntry
	err := DB.QueryRow(`
		SELECT id, workspace, summary, updated_at
		FROM sessions WHERE id = ?`,
		id,
	).Scan(&s.ID, &s.Workspace, &s.Summary, &s.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func SaveDBContentCache(hash, filePath, summary string, tokens int) error {
	updatedAt := time.Now().UTC().Format(time.RFC3339)
	_, err := DB.Exec(`
		INSERT INTO contentCache (hash, file_path, summary, tokens, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(hash) DO UPDATE SET
			file_path = excluded.file_path,
			summary = excluded.summary,
			tokens = excluded.tokens,
			updated_at = excluded.updated_at`,
		hash, filePath, summary, tokens, updatedAt,
	)
	return err
}

func GetDBContentCache(hash string) (*ContentCacheEntry, error) {
	var c ContentCacheEntry
	err := DB.QueryRow(`
		SELECT hash, file_path, summary, tokens, updated_at
		FROM contentCache WHERE hash = ?`,
		hash,
	).Scan(&c.Hash, &c.FilePath, &c.Summary, &c.Tokens, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}
