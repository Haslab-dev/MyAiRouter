package middleware

import (
	"fmt"
	"net/http"
	"strings"

	"myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
	pkgGateway "myAiRouter/pkg/gateway"
)

func Auth(ctx *context.GatewayContext, next HandlerFunc) error {
	settings, err := db.GetSettings()
	if err != nil || !settings.RequireLogin {
		ctx.UserID = "guest"
		ctx.AddStep("Auth", "success", "Authenticated as Guest")
		return next(ctx)
	}

	// 1. Check Bearer Token
	authHeader := ctx.Request.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		key := strings.TrimPrefix(authHeader, "Bearer ")
		valid, err := db.ValidateApiKey(key)
		if err == nil && valid {
			// Per-key scoping: model allowlist + daily token budget. Zero
			// value scope = unrestricted, so unscoped keys behave as before.
			if rec, err := db.FindApiKeyByValue(key); err == nil && rec != nil {
				modelName, _ := ctx.RequestBody["model"].(string)
				if modelName != "" && !rec.ModelAllowed(modelName) {
					ctx.WriteError(http.StatusForbidden, fmt.Sprintf("API key is not allowed to use model %q", modelName))
					ctx.AddStep("Auth", "failed", fmt.Sprintf("Model %s outside key allowlist", modelName))
					return nil
				}
				if rec.DailyLimitExceeded() {
					ctx.WriteError(http.StatusTooManyRequests, fmt.Sprintf("Daily token limit reached (%d) for this API key", rec.Scope.DailyTokenLimit))
					ctx.AddStep("Auth", "failed", "API key daily token budget exhausted")
					return nil
				}
			}
			ctx.UserID = key
			ctx.AddStep("Auth", "success", "API Key authenticated successfully")
			return next(ctx)
		}
	}

	// 2. Check Admin Session Cookie (Allow UI Playground calls directly via admin session)
	if cookie, err := ctx.Request.Cookie("session"); err == nil {
		if pkgGateway.ValidateSessionCookie(cookie.Value) {
			ctx.UserID = "admin"
			ctx.AddStep("Auth", "success", "Authenticated via Admin UI Session")
			return next(ctx)
		}
	}

	// 3. Fallback: If no valid Bearer token provided, check if system has an active API key
	keys, err := db.ListApiKeys()
	if err == nil {
		for _, k := range keys {
			if k.IsActive && k.Key != "" {
				ctx.UserID = k.Key
				ctx.AddStep("Auth", "success", "Authenticated via System Active API Key")
				return next(ctx)
			}
		}
	}

	ctx.WriteError(http.StatusUnauthorized, "Invalid or missing Bearer token")
	ctx.AddStep("Auth", "failed", "Missing valid Authorization header, session, or system API key")
	return nil
}
