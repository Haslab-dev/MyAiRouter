package db

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type ChatAttachment struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	Type     string `json:"type"` // "image", "file"
	MimeType string `json:"mimeType"`
	DataUrl  string `json:"dataUrl,omitempty"`
}

type ChatMessage struct {
	ID          string                 `json:"id"`
	Role        string                 `json:"role"`
	Content     string                 `json:"content"`
	Reasoning   string                 `json:"reasoning,omitempty"`
	Model       string                 `json:"model,omitempty"`
	Attachments []ChatAttachment       `json:"attachments,omitempty"`
	ImageUrl    string                 `json:"imageUrl,omitempty"`
	Timestamp   string                 `json:"timestamp"`
	IsError     bool                   `json:"isError,omitempty"`
	Meta        map[string]interface{} `json:"meta,omitempty"`
}

type ChatSession struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Model        string `json:"model"`
	SystemPrompt string `json:"systemPrompt"`
	MessageCount int    `json:"messageCount"`
	FilePath     string `json:"filePath"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

var sessionMu sync.Mutex

func GetChatSessionsDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(homeDir, ".myairouter", "sessions")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

func getSessionFilePath(sessionID string) (string, error) {
	dir, err := GetChatSessionsDir()
	if err != nil {
		return "", err
	}
	safeID := strings.ReplaceAll(sessionID, "/", "_")
	safeID = strings.ReplaceAll(safeID, "\\", "_")
	return filepath.Join(dir, safeID+".jsonl"), nil
}

func ListChatSessions() ([]ChatSession, error) {
	sessionMu.Lock()
	defer sessionMu.Unlock()

	rows, err := DB.Query(`
		SELECT id, title, model, systemPrompt, messageCount, filePath, createdAt, updatedAt
		FROM chatSessions
		ORDER BY updatedAt DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []ChatSession
	for rows.Next() {
		var s ChatSession
		var sysPrompt sql.NullString
		var model sql.NullString
		if err := rows.Scan(&s.ID, &s.Title, &model, &sysPrompt, &s.MessageCount, &s.FilePath, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		if sysPrompt.Valid {
			s.SystemPrompt = sysPrompt.String
		}
		if model.Valid {
			s.Model = model.String
		}
		sessions = append(sessions, s)
	}
	return sessions, nil
}

func GetChatSession(id string) (*ChatSession, []ChatMessage, error) {
	sessionMu.Lock()
	defer sessionMu.Unlock()

	var s ChatSession
	var sysPrompt sql.NullString
	var model sql.NullString
	err := DB.QueryRow(`
		SELECT id, title, model, systemPrompt, messageCount, filePath, createdAt, updatedAt
		FROM chatSessions
		WHERE id = ?`, id,
	).Scan(&s.ID, &s.Title, &model, &sysPrompt, &s.MessageCount, &s.FilePath, &s.CreatedAt, &s.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	if sysPrompt.Valid {
		s.SystemPrompt = sysPrompt.String
	}
	if model.Valid {
		s.Model = model.String
	}

	filePath, err := getSessionFilePath(id)
	if err != nil {
		return &s, nil, nil
	}

	messages, err := readMessagesFromJSONL(filePath)
	if err != nil {
		// If file doesn't exist yet, return empty list
		return &s, []ChatMessage{}, nil
	}

	return &s, messages, nil
}

func CreateChatSession(s *ChatSession) error {
	sessionMu.Lock()
	defer sessionMu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	if s.CreatedAt == "" {
		s.CreatedAt = now
	}
	if s.UpdatedAt == "" {
		s.UpdatedAt = now
	}
	if s.Title == "" {
		s.Title = "New Chat"
	}

	filePath, err := getSessionFilePath(s.ID)
	if err != nil {
		return err
	}
	s.FilePath = filePath

	// Ensure jsonl file exists
	f, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	_ = f.Close()

	_, err = DB.Exec(`
		INSERT INTO chatSessions (id, title, model, systemPrompt, messageCount, filePath, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			title = excluded.title,
			model = excluded.model,
			systemPrompt = excluded.systemPrompt,
			updatedAt = excluded.updatedAt
	`, s.ID, s.Title, s.Model, s.SystemPrompt, s.MessageCount, s.FilePath, s.CreatedAt, s.UpdatedAt)

	return err
}

func UpdateChatSession(id, title, model, systemPrompt string) error {
	sessionMu.Lock()
	defer sessionMu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	_, err := DB.Exec(`
		UPDATE chatSessions
		SET title = CASE WHEN ? != '' THEN ? ELSE title END,
		    model = CASE WHEN ? != '' THEN ? ELSE model END,
		    systemPrompt = ?,
		    updatedAt = ?
		WHERE id = ?
	`, title, title, model, model, systemPrompt, now, id)
	return err
}

func AppendChatMessage(sessionID string, msg *ChatMessage) error {
	sessionMu.Lock()
	defer sessionMu.Unlock()

	filePath, err := getSessionFilePath(sessionID)
	if err != nil {
		return err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	if msg.Timestamp == "" {
		msg.Timestamp = now
	}
	if msg.ID == "" {
		msg.ID = fmt.Sprintf("msg-%d", time.Now().UnixNano())
	}

	f, err := os.OpenFile(filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	lineBytes, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	if _, err := f.Write(append(lineBytes, '\n')); err != nil {
		return err
	}

	// Update session metadata
	_, _ = DB.Exec(`
		UPDATE chatSessions
		SET messageCount = messageCount + 1,
		    updatedAt = ?
		WHERE id = ?
	`, now, sessionID)

	return nil
}

func DeleteChatSession(id string) error {
	sessionMu.Lock()
	defer sessionMu.Unlock()

	filePath, _ := getSessionFilePath(id)
	if filePath != "" {
		_ = os.Remove(filePath)
	}

	_, err := DB.Exec("DELETE FROM chatSessions WHERE id = ?", id)
	return err
}

func readMessagesFromJSONL(filePath string) ([]ChatMessage, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var messages []ChatMessage
	scanner := bufio.NewScanner(f)
	// Allow large lines (up to 10MB for base64 images/attachments)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 10*1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if len(line) == 0 {
			continue
		}
		var msg ChatMessage
		if err := json.Unmarshal([]byte(line), &msg); err == nil {
			messages = append(messages, msg)
		}
	}
	return messages, scanner.Err()
}
