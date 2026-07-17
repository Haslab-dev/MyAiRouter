package middleware

import (
	"net/http"
	"strings"

	"myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
)

func Auth(ctx *context.GatewayContext, next HandlerFunc) error {
	ctx.AddStep("Auth", "started", "Authenticating request")
	settings, err := db.GetSettings()
	if err != nil || !settings.RequireLogin {
		ctx.UserID = "guest"
		ctx.AddStep("Auth", "success", "Authenticated as Guest")
		return next(ctx)
	}

	authHeader := ctx.Request.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		ctx.WriteError(http.StatusUnauthorized, "Invalid or missing Bearer token")
		ctx.AddStep("Auth", "failed", "Missing Authorization header")
		return nil
	}
	key := strings.TrimPrefix(authHeader, "Bearer ")

	valid, err := db.ValidateApiKey(key)
	if err != nil || !valid {
		ctx.WriteError(http.StatusUnauthorized, "Invalid API key")
		ctx.AddStep("Auth", "failed", "API Key validation failed")
		return nil
	}

	ctx.UserID = key
	ctx.AddStep("Auth", "success", "API Key authenticated successfully")
	return next(ctx)
}
