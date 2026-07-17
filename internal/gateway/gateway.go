package gateway

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/google/uuid"
	"myAiRouter/internal/gateway/context"
	"myAiRouter/internal/gateway/middleware"
	pkgGateway "myAiRouter/pkg/gateway"
)

func RegisterGatewayRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /v1/chat/completions", HandleChatCompletions)
	mux.HandleFunc("GET /v1/models", pkgGateway.HandleListModels)
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

	pipe := middleware.NewPipeline()

	// Pipeline: Wrappers first, then Resolver, then Routing/Retry loops, then dynamic filters/executors
	pipe.Use(middleware.Observability)
	pipe.Use(middleware.Auth)
	pipe.Use(middleware.RateLimit)
	pipe.Use(middleware.ModelResolver)
	pipe.Use(middleware.Routing)

	// Retry acts as loop coordinator over connection targets
	pipe.Use(middleware.Retry)
	pipe.Use(middleware.PromptRewrite)
	pipe.Use(middleware.Compression)
	pipe.Use(middleware.Cache)
	pipe.Use(middleware.Guardrail)
	pipe.Use(middleware.Provider)

	_ = pipe.Run(ctx)
}
