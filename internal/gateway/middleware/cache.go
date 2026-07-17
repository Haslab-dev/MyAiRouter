package middleware

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"

	"myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
)

func Cache(ctx *context.GatewayContext, next HandlerFunc) error {
	ctx.AddStep("Cache", "started", "Checking exact-match response cache")

	// Bypass caching for streaming requests
	if ctx.IsStream {
		ctx.AddStep("Cache", "skipped", "Streaming request, bypass cache")
		return next(ctx)
	}

	messagesBytes, err := json.Marshal(ctx.RequestBody["messages"])
	if err != nil {
		return next(ctx)
	}

	// Compute cache key: SHA256 of messages list + target model
	hasher := sha256.New()
	hasher.Write(messagesBytes)
	hasher.Write([]byte(ctx.Model))
	key := fmt.Sprintf("%x", hasher.Sum(nil))

	// Search in KV store
	var cachedVal string
	err = db.DB.QueryRow("SELECT value FROM kv WHERE scope = 'cache' AND key = ?", key).Scan(&cachedVal)
	if err == nil && cachedVal != "" {
		// Cache Hit
		ctx.ResponseBody = []byte(cachedVal)
		ctx.ResponseCode = http.StatusOK
		ctx.ResponseWriter.Header().Set("Content-Type", "application/json")
		ctx.ResponseWriter.WriteHeader(http.StatusOK)
		_, _ = ctx.ResponseWriter.Write(ctx.ResponseBody)

		ctx.Metadata["cacheHit"] = true
		ctx.AddStep("Cache", "success", "Cache hit! Served cached response")
		return nil
	}

	ctx.AddStep("Cache", "miss", "Cache miss, forwarding request")
	err = next(ctx)
	if err != nil {
		return err
	}

	// Cache successful non-streaming responses
	if ctx.ResponseCode == http.StatusOK && len(ctx.ResponseBody) > 0 && !ctx.IsStream {
		_, _ = db.DB.Exec(
			"INSERT OR REPLACE INTO kv (scope, key, value) VALUES ('cache', ?, ?)",
			key, string(ctx.ResponseBody),
		)
		ctx.AddStep("Cache", "success", "Response cached")
	}

	return nil
}
