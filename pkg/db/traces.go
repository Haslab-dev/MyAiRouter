package db

import (
	"database/sql"
	"encoding/json"
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
		e.Data = sanitizeTraceDataForList(e.Data)
		entries = append(entries, e)
	}
	return entries, nil
}

func GetRecentTracesPaginated(page, perPage int) ([]TraceEntry, int, error) {
	var total int
	err := DB.QueryRow(`SELECT COUNT(*) FROM requestDetails`).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	if offset < 0 {
		offset = 0
	}

	rows, err := DB.Query(
		`SELECT id, timestamp, provider, model, connectionId, status, data 
		FROM requestDetails ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
		perPage, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var entries []TraceEntry
	for rows.Next() {
		var e TraceEntry
		if err := rows.Scan(&e.ID, &e.Timestamp, &e.Provider, &e.Model, &e.ConnectionID, &e.Status, &e.Data); err != nil {
			return nil, 0, err
		}
		e.Data = sanitizeTraceDataForList(e.Data)
		entries = append(entries, e)
	}
	return entries, total, nil
}

func sanitizeTraceDataForList(dataJSON string) string {
	if dataJSON == "" {
		return ""
	}
	var data map[string]interface{}
	if err := json.Unmarshal([]byte(dataJSON), &data); err != nil {
		return dataJSON
	}
	// Strip heavy original and optimized message arrays for the list view
	delete(data, "originalMessages")
	delete(data, "optimizedMessages")
	cleaned, err := json.Marshal(data)
	if err != nil {
		return dataJSON
	}
	return string(cleaned)
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
