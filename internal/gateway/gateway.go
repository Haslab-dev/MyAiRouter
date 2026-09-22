package gateway

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"myAiRouter/internal/gateway/context"
	"myAiRouter/internal/gateway/middleware"
	pkgGateway "myAiRouter/pkg/gateway"
)

func RegisterGatewayRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/chat/completions", HandleChatCompletions)
	mux.HandleFunc("GET /v1/models", pkgGateway.HandleListModels)
	mux.HandleFunc("POST /v1/images/generations", pkgGateway.HandleImagesGenerations)
	mux.HandleFunc("POST /v1/embeddings", authenticatePassthrough(HandleEmbeddings))
	mux.HandleFunc("POST /v1/audio/transcriptions", authenticatePassthrough(HandleAudioTranscriptions))
	mux.HandleFunc("POST /v1/audio/translations", authenticatePassthrough(HandleAudioTranslations))
}

// authenticatePassthrough runs the Auth middleware (bearer key + per-key model
// allowlist + daily token budget) in front of a passthrough endpoint, so
// scoped keys are enforced identically on /v1/embeddings and /v1/audio/*.
func authenticatePassthrough(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := context.NewGatewayContext(w, r)
		ctx.RequestID = uuid.New().String()

		// Auth's scoping check reads ctx.RequestBody["model"]. Embeddings carry
		// it as JSON; audio endpoints carry it as a multipart form field.
		requestBody := map[string]interface{}{}
		if strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			if raw, err := io.ReadAll(r.Body); err == nil {
				r.Body = io.NopCloser(bytes.NewReader(raw))
				var parsed map[string]interface{}
				if json.Unmarshal(raw, &parsed) == nil {
					requestBody = parsed
				}
			}
		} else if r.MultipartForm == nil {
			// Bound the read: ParseMultipartForm holds files in memory up to
			// this limit, matching the relay's own limit.
			_ = r.ParseMultipartForm(64 << 20)
			r.MultipartForm.Value["model"] = []string{r.FormValue("model")}
		}
		if _, hasModel := requestBody["model"]; !hasModel {
			if m := r.FormValue("model"); m != "" {
				requestBody["model"] = m
			}
		}
		ctx.RequestBody = requestBody

		pipe := middleware.NewPipeline()
		pipe.Use(middleware.Auth)
		pipe.Use(func(*context.GatewayContext, middleware.HandlerFunc) error {
			handler(w, r)
			return nil
		})
		_ = pipe.Run(ctx)
	}
}

func HandleChatCompletions(w http.ResponseWriter, r *http.Request) {
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": "Failed to read request body"})
		return
	}

	var body map[string]interface{}
	if err := json.Unmarshal(bodyBytes, &body); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": "Invalid JSON body"})
		return
	}

	ctx := context.NewGatewayContext(w, r)
	ctx.RequestID = uuid.New().String()
	ctx.RequestBody = body

	if streamVal, ok := body["stream"].(bool); ok {
		ctx.IsStream = streamVal
	}

	// Live-activity record for the Overview animation. Opened here (not in
	// NewGatewayContext) because this is the only endpoint whose whole
	// lifecycle the pipeline owns end to end.
	modelName, _ := body["model"].(string)
	ctx.BeginLiveActivity(modelName)

	pipe := middleware.NewPipeline()

	pipe.Use(middleware.Observability)
	pipe.Use(middleware.Auth)
	pipe.Use(middleware.RateLimit)
	pipe.Use(middleware.ModelResolver)
	pipe.Use(middleware.Routing)

	// Retry acts as loop coordinator over connection targets
	pipe.Use(middleware.Retry)
	pipe.Use(middleware.Prepare)
	pipe.Use(middleware.Guardrail)
	pipe.Use(middleware.Provider)

	_ = pipe.Run(ctx)

	// The pipeline returned, so the response is on the wire. Close the live
	// record unconditionally: a session that never finalizes would animate
	// forever in the dashboard.
	ctx.FinishLiveActivity()
}
