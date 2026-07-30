package session

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"myAiRouter/pkg/db"
)

type Session struct {
	ID                  string            `json:"id"`
	Workspace           string            `json:"workspace"`
	ConversationSummary string            `json:"conversationSummary"`
	FileHashes          map[string]string `json:"fileHashes"` // path -> sha256
	ToolCache           map[string]string `json:"toolCache"`  // hash -> result
	LastSeen            time.Time         `json:"lastSeen"`
}

type Manager struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

var globalManager *Manager
var once sync.Once

func GetManager() *Manager {
	once.Do(func() {
		globalManager = &Manager{
			sessions: make(map[string]*Session),
		}
	})
	return globalManager
}

func HashContent(content string) string {
	h := sha256.Sum256([]byte(content))
	return hex.EncodeToString(h[:])
}

func (m *Manager) GetOrCreate(sessionID, workspace string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()

	if sessionID == "" {
		sessionID = "default_session"
	}

	if sess, ok := m.sessions[sessionID]; ok {
		sess.LastSeen = time.Now()
		if workspace != "" && sess.Workspace == "" {
			sess.Workspace = workspace
		}
		return sess
	}

	// Try DB restore
	dbSess, _ := db.GetDBSession(sessionID)
	summary := ""
	dbWorkspace := workspace
	if dbSess != nil {
		summary = dbSess.Summary
		if dbSess.Workspace != "" {
			dbWorkspace = dbSess.Workspace
		}
	}

	sess := &Session{
		ID:                  sessionID,
		Workspace:           dbWorkspace,
		ConversationSummary: summary,
		FileHashes:          make(map[string]string),
		ToolCache:           make(map[string]string),
		LastSeen:            time.Now(),
	}

	m.sessions[sessionID] = sess
	return sess
}

func (m *Manager) DeduplicateContent(filePath, content string) (dedupedContent string, isHit bool, hash string) {
	if len(content) < 200 {
		return content, false, ""
	}

	hash = HashContent(content)

	// Check DB or memory cache
	cached, _ := db.GetDBContentCache(hash)
	if cached != nil && cached.Summary != "" {
		summaryRef := fmt.Sprintf("[Cached File: %s | SHA256: %s… | %d chars]\nSummary: %s",
			filePath, hash[:8], len(content), cached.Summary,
		)
		return summaryRef, true, hash
	}

	// Create concise summary snippet for long file content (first 300 chars + last 100 chars)
	trimmed := strings.TrimSpace(content)
	summarySnippet := trimmed
	if len(trimmed) > 400 {
		summarySnippet = fmt.Sprintf("%s\n...[compressed %d bytes]...\n%s",
			trimmed[:300], len(trimmed)-400, trimmed[len(trimmed)-100:],
		)
	}

	_ = db.SaveDBContentCache(hash, filePath, summarySnippet, len(content)/4)
	return content, false, hash
}

func (m *Manager) Save(sess *Session) {
	m.mu.Lock()
	defer m.mu.Unlock()

	sess.LastSeen = time.Now()
	_ = db.SaveDBSession(sess.ID, sess.Workspace, sess.ConversationSummary)
}
