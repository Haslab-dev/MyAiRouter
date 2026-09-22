package logger

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

type LogEntry struct {
	ID        int64  `json:"id"`
	Timestamp string `json:"timestamp"`
	Method    string `json:"method,omitempty"`
	Path      string `json:"path,omitempty"`
	From      string `json:"from,omitempty"`
	Status    int    `json:"status,omitempty"`
	ReqBody   string `json:"req_body,omitempty"`
	RespBody  string `json:"resp_body,omitempty"`
	Error     string `json:"error,omitempty"`
	Duration  string `json:"duration,omitempty"`
	Message   string `json:"message,omitempty"`
	Type      string `json:"type"`
}

var sensitiveFields = []string{
	"password",
	"passwd",
	"pwd",
	"api_key",
	"api_key",
	"apikey",
	"api-key",
	"apiKey",
	"key",
	"secret_key",
	"secretkey",
	"secret",
	"token",
	"access_token",
	"accessToken",
	"refresh_token",
	"refreshToken",
	"id_token",
	"idToken",
	"bearer",
	"bearer_token",
	"bearerToken",
	"authorization",
	"auth",
	"auth_token",
	"authToken",
	"x_api_key",
	"x-api-key",
	"xapikey",
	"private_key",
	"privatekey",
	"private-key",
	"access_key",
	"accesskey",
	"access-key",
	"client_secret",
	"clientsecret",
	"client_id",
	"clientid",
}

func isSensitiveKey(key string) bool {
	keyLower := strings.ToLower(key)
	for _, s := range sensitiveFields {
		if keyLower == s {
			return true
		}
	}
	return false
}

func redactValue(v interface{}) bool {
	redacted := false

	switch val := v.(type) {
	case map[string]interface{}:
		for key, val := range val {
			if isSensitiveKey(key) {
				if str, ok := val.(string); ok && str != "" {
					v.(map[string]interface{})[key] = "[REDACTED]"
					redacted = true
				}
			}
			if redactValue(val) {
				redacted = true
			}
		}
	case []interface{}:
		for i, item := range val {
			if redactValue(item) {
				redacted = true
				val[i] = item
			}
		}
	}
	return redacted
}

func redactJSON(input string) string {
	if input == "" {
		return ""
	}

	var data interface{}
	if err := json.Unmarshal([]byte(input), &data); err != nil {
		return input
	}

	if !redactValue(data) {
		return input
	}

	result, err := json.Marshal(data)
	if err != nil {
		return input
	}
	return string(result)
}

func sanitizeForDisplay(input string, maxLen int) string {
	if input == "" {
		return ""
	}
	redacted := redactJSON(input)
	if len(redacted) > maxLen {
		return redacted[:maxLen] + "...[TRUNCATED]"
	}
	return redacted
}

var (
	mu            sync.RWMutex
	logs          []LogEntry
	maxLog        = 500
	nextID        int64 = 1
	pendingMap    = make(map[int64]int) // ID -> slice index helper if needed
)

func LogRequest(method, path, from, reqBody string) int64 {
	id := getNextID()
	entry := LogEntry{
		ID:        id,
		Timestamp: time.Now().Format("2006-01-02 15:04:05.000"),
		Method:    method,
		Path:      path,
		From:      from,
		Type:      "request",
	}
	if reqBody != "" {
		entry.ReqBody = sanitizeForDisplay(reqBody, 500)
	}
	addEntry(entry)
	return id
}

func LogResponse(status int, respBody string, duration string) {
	mu.Lock()
	defer mu.Unlock()

	// Limit backward search to at most 50 entries for high speed O(1) bound
	searchLimit := len(logs) - 50
	if searchLimit < 0 {
		searchLimit = 0
	}

	for i := len(logs) - 1; i >= searchLimit; i-- {
		if logs[i].Type == "request" && logs[i].Status == 0 {
			logs[i].Status = status
			logs[i].RespBody = sanitizeForDisplay(respBody, 500)
			logs[i].Duration = duration
			if status >= 400 {
				errorMsg := extractErrorMessage(respBody)
				if errorMsg != "" {
					logs[i].Error = errorMsg
				} else {
					logs[i].Error = fmt.Sprintf("HTTP %d", status)
				}
			}
			return
		}
	}
}

func extractErrorMessage(body string) string {
	if body == "" {
		return ""
	}

	var data map[string]interface{}
	if err := json.Unmarshal([]byte(body), &data); err == nil {
		if msg, ok := data["error"].(string); ok && msg != "" {
			return msg
		}
		if msg, ok := data["message"].(string); ok && msg != "" {
			return msg
		}
		if detail, ok := data["error"].(map[string]interface{}); ok {
			if msg, ok := detail["message"].(string); ok && msg != "" {
				return msg
			}
		}
	}

	if len(body) > 100 {
		return body[:100] + "..."
	}
	return body
}

func LogError(msg string) {
	entry := LogEntry{
		ID:        getNextID(),
		Timestamp: time.Now().Format("2006-01-02 15:04:05.000"),
		Error:     msg,
		Type:      "error",
	}
	addEntry(entry)
}

func LogMessage(msg string) {
	entry := LogEntry{
		ID:        getNextID(),
		Timestamp: time.Now().Format("2006-01-02 15:04:05.000"),
		Message:   msg,
		Type:      "system",
	}
	addEntry(entry)
}

func Logf(format string, args ...interface{}) {
	LogMessage(fmt.Sprintf(format, args...))
}

func getNextID() int64 {
	mu.Lock()
	defer mu.Unlock()
	id := nextID
	nextID++
	return id
}

func addEntry(entry LogEntry) {
	mu.Lock()
	defer mu.Unlock()
	if len(logs) >= maxLog {
		// Zero out head element to allow GC cleanup of strings/buffers
		logs[0] = LogEntry{}
		logs = logs[1:]
	}
	logs = append(logs, entry)
}

func GetLogs() []LogEntry {
	mu.RLock()
	defer mu.RUnlock()
	res := make([]LogEntry, len(logs))
	copy(res, logs)
	return res
}

func GetLogsPaginated(page, perPage int) ([]LogEntry, int) {
	mu.RLock()
	defer mu.RUnlock()

	total := len(logs)
	if total == 0 {
		return []LogEntry{}, 0
	}

	offset := (page - 1) * perPage
	if offset < 0 {
		offset = 0
	}
	if offset >= total {
		return []LogEntry{}, total
	}

	end := offset + perPage
	if end > total {
		end = total
	}

	// Return in reverse order (latest first)
	res := make([]LogEntry, 0, end-offset)
	for i := end - 1; i >= offset; i-- {
		res = append(res, logs[i])
	}
	return res, total
}

func ClearLogs() {
	mu.Lock()
	defer mu.Unlock()
	logs = nil
	nextID = 1
}

func GetLogsJSON() string {
	mu.RLock()
	defer mu.RUnlock()
	data, _ := json.Marshal(map[string]interface{}{"logs": logs})
	return string(data)
}
