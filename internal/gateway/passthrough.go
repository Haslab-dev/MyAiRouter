package gateway

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"myAiRouter/internal/gateway/middleware"
	"myAiRouter/internal/gateway/providers"
	"myAiRouter/pkg/db"
)

// Passthrough endpoints (/v1/embeddings, /v1/audio/*) deliberately skip the
// chat pipeline: no compression, no guardrails, no combo engine — those
// middlewares assume the chat-completions request shape. What they keep:
// gateway auth (with per-key scoping), proxy-aware clients, anti-detect
// headers, health-ordered connection selection and usage telemetry.

// resolvePassthroughTarget returns the first healthy upstream target for one
// requested model plus the provider-resolved model id (prefixes stripped,
// custom aliases expanded).
func resolvePassthroughTarget(w http.ResponseWriter, model string) (*db.ProviderConnection, string, bool) {
	if model == "" {
		writeError(w, http.StatusBadRequest, "Missing model parameter")
		return nil, "", false
	}
	targets := middleware.ResolveConnectionTargets([]string{model})
	if len(targets) == 0 {
		writeError(w, http.StatusServiceUnavailable, fmt.Sprintf("No active upstream connections found for model %q", model))
		return nil, "", false
	}
	return &targets[0].Connection, targets[0].ModelName, true
}

// passthroughBase returns the connection's configured baseUrl, falling back
// to the provider's default upstream.
func passthroughBase(conn *db.ProviderConnection) (string, bool) {
	baseUrl, _ := conn.Data["baseUrl"].(string)
	if baseUrl == "" {
		baseUrl = defaultBaseUrlFor(conn.Provider)
	}
	if baseUrl == "" {
		return "", false
	}
	return strings.TrimSuffix(baseUrl, "/"), true
}

// defaultBaseUrlFor mirrors the provider→baseUrl table used by the chat
// executors, so passthrough works for connections without explicit baseUrl.
func defaultBaseUrlFor(provider string) string {
	switch provider {
	case "groq":
		return "https://api.groq.com/openai/v1"
	case "nvidia":
		return "https://integrate.api.nvidia.com/v1"
	case "openrouter":
		return "https://openrouter.ai/api/v1"
	case "deepseek":
		return "https://api.deepseek.com/v1"
	case "glm":
		return "https://open.bigmodel.cn/api/paas/v4"
	case "opencode-zen", "opencode":
		return "https://opencode.ai/zen/v1"
	case "opencode-go":
		return "https://opencode.ai/zen/go/v1"
	case "kenari":
		return "https://kenari.id/v1"
	case "sumopod":
		return "https://ai.sumopod.com/v1"
	case "mistral":
		return "https://api.mistral.ai/v1"
	case "ollama":
		return "http://localhost:11434/v1"
	case "qwen":
		return "https://dashscope.aliyuncs.com/compatible-mode/v1"
	case "cerebras":
		return "https://api.cerebras.ai/v1"
	case "fireworks":
		return "https://api.fireworks.ai/inference/v1"
	case "anthropic":
		return "https://api.anthropic.com/v1"
	case "gemini":
		return "https://generativelanguage.googleapis.com/v1beta"
	default:
		return "https://api.openai.com/v1"
	}
}

func recordPassthroughUsage(provider, model string, conn *db.ProviderConnection, endpoint string, promptTokens, completionTokens, status int) {
	now := time.Now().UTC().Format(time.RFC3339)
	stat := "failed"
	if status < 400 {
		stat = "success"
	}
	_, _ = db.DB.Exec(`INSERT INTO usageHistory (timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cachedTokens, cost, status, tokens, meta)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, '{}', '{}')`,
		now, provider, model, conn.ID, "", endpoint, promptTokens, completionTokens, stat)
}

// writeError emits an OpenAI-style error envelope.
func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]interface{}{"message": msg, "type": "api_error"},
	})
}

// HandleEmbeddings proxies POST /v1/embeddings (OpenAI-compatible) to the
// resolved connection's provider. Usage is logged from the response body.
func HandleEmbeddings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Failed to read request body")
		return
	}
	var body map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &body); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON body")
		return
	}
	model, _ := body["model"].(string)
	conn, upstreamModel, ok := resolvePassthroughTarget(w, model)
	if !ok {
		return
	}
	base, okBase := passthroughBase(conn)
	if !okBase {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Provider %q has no baseUrl configured", conn.Provider))
		return
	}

	body["model"] = upstreamModel
	payload, err := json.Marshal(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, base+"/embeddings", bytes.NewReader(payload))
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Upstream request failed: %v", err))
		return
	}
	if key, _ := conn.Data["apiKey"].(string); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	req.Header.Set("Content-Type", "application/json")
	providers.ApplyAntiDetect(req, conn)

	resp, err := providers.ClientFor(conn).Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Upstream request failed: %v", err))
		return
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Reading upstream response: %v", err))
		return
	}

	var usage struct {
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(respBody, &usage) == nil {
		promptTokens := usage.Usage.PromptTokens
		if promptTokens == 0 && usage.Usage.TotalTokens > usage.Usage.CompletionTokens {
			promptTokens = usage.Usage.TotalTokens - usage.Usage.CompletionTokens
		}
		if promptTokens > 0 {
			recordPassthroughUsage(conn.Provider, upstreamModel, conn, "/v1/embeddings", promptTokens, usage.Usage.CompletionTokens, resp.StatusCode)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBody)
}

// relayMultipart copies a multipart form from the client request to a new
// upstream request, replacing the "model" field with the resolved upstream
// model id. Audio endpoints (transcriptions, translations) all use
// multipart/form-data, so they share this relay.
func relayMultipart(w http.ResponseWriter, r *http.Request, upstreamPath string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid multipart form: "+err.Error())
		return
	}

	conn, upstreamModel, ok := resolvePassthroughTarget(w, r.FormValue("model"))
	if !ok {
		return
	}
	base, okBase := passthroughBase(conn)
	if !okBase {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Provider %q has no baseUrl configured", conn.Provider))
		return
	}

	buf := &bytes.Buffer{}
	mw := multipart.NewWriter(buf)

	for fieldName, files := range r.MultipartForm.File {
		for _, fh := range files {
			src, err := fh.Open()
			if err != nil {
				writeError(w, http.StatusBadRequest, "Cannot read uploaded file: "+err.Error())
				return
			}
			dst, err := mw.CreateFormFile(fieldName, fh.Filename)
			if err != nil {
				src.Close()
				writeError(w, http.StatusBadRequest, "Cannot build upstream form: "+err.Error())
				return
			}
			if _, err := io.Copy(dst, src); err != nil {
				src.Close()
				writeError(w, http.StatusBadRequest, "Cannot copy uploaded file: "+err.Error())
				return
			}
			src.Close()
		}
	}
	for key, vals := range r.MultipartForm.Value {
		for _, v := range vals {
			if key == "model" {
				v = upstreamModel
			}
			if err := mw.WriteField(key, v); err != nil {
				writeError(w, http.StatusBadRequest, "Cannot build upstream form: "+err.Error())
				return
			}
		}
	}
	if err := mw.Close(); err != nil {
		writeError(w, http.StatusBadGateway, "Cannot finalize upstream form: "+err.Error())
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, base+upstreamPath, buf)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Upstream request failed: %v", err))
		return
	}
	if key, _ := conn.Data["apiKey"].(string); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	providers.ApplyAntiDetect(req, conn)

	resp, err := providers.ClientFor(conn).Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Upstream request failed: %v", err))
		return
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Reading upstream response: %v", err))
		return
	}

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/json"
	}
	w.Header().Set("Content-Type", ct)
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBody)
}

// HandleAudioTranscriptions proxies POST /v1/audio/transcriptions.
// HandleAudioTranslations proxies POST /v1/audio/translations.
func HandleAudioTranscriptions(w http.ResponseWriter, r *http.Request) {
	relayMultipart(w, r, "/audio/transcriptions")
}

func HandleAudioTranslations(w http.ResponseWriter, r *http.Request) {
	relayMultipart(w, r, "/audio/translations")
}
