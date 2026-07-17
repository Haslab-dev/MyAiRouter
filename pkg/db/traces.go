package db

import (
	"database/sql"
	"time"
)

type TraceEntry struct {
	ID           string `json:"id"`
	Timestamp    string `json:"timestamp"`
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	ConnectionID string `json:"connectionId"`
	Status       string `json:"status"`
	Data         string `json:"data"` // JSON trace metadata
}

func SaveRequestTrace(id, provider, model, connectionId, status, data string) error {
	timestamp := time.Now().UTC().Format(time.RFC3339)
	_, err := DB.Exec(
		`INSERT INTO requestDetails (id, timestamp, provider, model, connectionId, status, data)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data`,
		id, timestamp, provider, model, connectionId, status, data,
	)
	return err
}

func GetRecentTraces(limit int) ([]TraceEntry, error) {
	rows, err := DB.Query(
		`SELECT id, timestamp, provider, model, connectionId, status, data 
		FROM requestDetails ORDER BY timestamp DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []TraceEntry
	for rows.Next() {
		var e TraceEntry
		if err := rows.Scan(&e.ID, &e.Timestamp, &e.Provider, &e.Model, &e.ConnectionID, &e.Status, &e.Data); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, nil
}

func GetTraceByID(id string) (*TraceEntry, error) {
	var e TraceEntry
	err := DB.QueryRow(
		`SELECT id, timestamp, provider, model, connectionId, status, data 
		FROM requestDetails WHERE id = ?`,
		id,
	).Scan(&e.ID, &e.Timestamp, &e.Provider, &e.Model, &e.ConnectionID, &e.Status, &e.Data)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}
