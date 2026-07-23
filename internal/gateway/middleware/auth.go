package middleware

import (
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
