package gateway

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"myAiRouter/pkg/db"
)

func handleChatSessions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		sessions, err := db.ListChatSessions()
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		if sessions == nil {
			sessions = []db.ChatSession{}
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"sessions": sessions})

	case http.MethodPost:
		var s db.ChatSession
		if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}
		if s.ID == "" {
			s.ID = fmt.Sprintf("session-%d", time.Now().UnixMilli())
		}
		if s.Title == "" {
			s.Title = "New Chat"
		}
		if err := db.CreateChatSession(&s); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(s)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func handleChatSessionDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	id := strings.TrimPrefix(r.URL.Path, "/api/chat/sessions/")
	id = strings.TrimSpace(id)

	if id == "" {
		WriteErrorResponse(w, http.StatusBadRequest, "Missing session ID")
		return
	}

	// Subroutes: /api/chat/sessions/<id>/append
	if strings.HasSuffix(id, "/append") {
		sessionID := strings.TrimSuffix(id, "/append")
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		var msg db.ChatMessage
		if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON message body")
			return
		}
		if err := db.AppendChatMessage(sessionID, &msg); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "message": msg})
		return
	}

	// Subroutes: /api/chat/sessions/<id>/export
	if strings.HasSuffix(id, "/export") {
		sessionID := strings.TrimSuffix(id, "/export")
		session, messages, err := db.GetChatSession(sessionID)
		if err != nil || session == nil {
			WriteErrorResponse(w, http.StatusNotFound, "Session not found")
			return
		}
		w.Header().Set("Content-Type", "application/x-jsonlines")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"chat-%s.jsonl\"", sessionID))
		for _, m := range messages {
			b, _ := json.Marshal(m)
			_, _ = w.Write(append(b, '\n'))
		}
		return
	}

	switch r.Method {
	case http.MethodGet:
		session, messages, err := db.GetChatSession(id)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		if session == nil {
			WriteErrorResponse(w, http.StatusNotFound, "Session not found")
			return
		}
		if messages == nil {
			messages = []db.ChatMessage{}
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"session":  session,
			"messages": messages,
		})

	case http.MethodPatch, http.MethodPut:
		var body struct {
			Title        string `json:"title"`
			Model        string `json:"model"`
			SystemPrompt string `json:"systemPrompt"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}
		if err := db.UpdateChatSession(id, body.Title, body.Model, body.SystemPrompt); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})

	case http.MethodDelete:
		if err := db.DeleteChatSession(id); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"ok": true})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func HandleImagesGenerations(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var reqBody struct {
		Prompt         string `json:"prompt"`
		Model          string `json:"model"`
		N              int    `json:"n"`
		Size           string `json:"size"`
		ResponseFormat string `json:"response_format"`
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		WriteErrorResponse(w, http.StatusBadRequest, "Failed to read request body")
		return
	}

	if err := json.Unmarshal(bodyBytes, &reqBody); err != nil {
		WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	prompt := strings.TrimSpace(reqBody.Prompt)
	if prompt == "" {
		WriteErrorResponse(w, http.StatusBadRequest, "Prompt is required")
		return
	}

	// 1. Check if an active upstream OpenAI or compatible provider has image generation configured
	conns, err := db.ListConnections()
	var imageKey string
	var imageBaseURL string
	if err == nil {
		for i := range conns {
			c := &conns[i]
			key, _ := c.Data["apiKey"].(string)
			bURL, _ := c.Data["baseUrl"].(string)
			if c.IsActive && key != "" && (strings.Contains(strings.ToLower(c.Provider), "openai") || strings.Contains(strings.ToLower(c.Provider), "azure")) {
				imageKey = key
				if bURL != "" {
					imageBaseURL = bURL
				} else {
					imageBaseURL = "https://api.openai.com/v1"
				}
				break
			}
		}
	}

	// If OpenAI connection available, try proxying to upstream /v1/images/generations
	if imageKey != "" && imageBaseURL != "" {
		upstreamURL := strings.TrimSuffix(imageBaseURL, "/") + "/images/generations"
		httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, upstreamURL, bytes.NewReader(bodyBytes))
		if err == nil {
			httpReq.Header.Set("Content-Type", "application/json")
			httpReq.Header.Set("Authorization", "Bearer "+imageKey)

			client := &http.Client{Timeout: 60 * time.Second}
			resp, err := client.Do(httpReq)
			if err == nil && resp.StatusCode == http.StatusOK {
				defer resp.Body.Close()
				w.WriteHeader(http.StatusOK)
				_, _ = io.Copy(w, resp.Body)
				return
			}
		}
	}

	// 2. High-quality zero-config fallback image generator (Pollinations AI)
	encodedPrompt := url.PathEscape(prompt)
	width := 1024
	height := 1024
	if reqBody.Size == "512x512" {
		width = 512
		height = 512
	} else if reqBody.Size == "768x768" {
		width = 768
		height = 768
	}

	seed := time.Now().UnixNano() % 100000
	imageUrl := fmt.Sprintf("https://image.pollinations.ai/prompt/%s?width=%d&height=%d&seed=%d&nologo=true", encodedPrompt, width, height, seed)

	resp := map[string]interface{}{
		"created": time.Now().Unix(),
		"data": []map[string]string{
			{
				"url":            imageUrl,
				"revised_prompt": prompt,
			},
		},
	}

	_ = json.NewEncoder(w).Encode(resp)
}
