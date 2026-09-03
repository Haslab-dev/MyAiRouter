package middleware

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
)

func Cache(ctx *context.GatewayContext, next HandlerFunc) error {
	// Bypass caching for streaming requests or when cache bypass headers are present
	bypass := ctx.IsStream
	if ctx.Request != nil {
		cc := ctx.Request.Header.Get("Cache-Control")
		pragma := ctx.Request.Header.Get("Pragma")
		if strings.Contains(strings.ToLower(cc), "no-cache") || strings.Contains(strings.ToLower(cc), "no-store") || strings.ToLower(pragma) == "no-cache" {
			bypass = true
		}
		if ctx.Request.Header.Get("X-No-Cache") == "true" || ctx.Request.Header.Get("X-Cache-Bypass") == "true" || ctx.Request.Header.Get("X-Skip-Cache") == "true" {
			bypass = true
		}
	}
	if bVal, ok := ctx.RequestBody["bypass_cache"].(bool); ok && bVal {
		bypass = true
	}

	if bypass {
		ctx.AddStep("Cache", "skipped", "Bypass cache requested")
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
