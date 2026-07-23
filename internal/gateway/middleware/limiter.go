package middleware

import (
	"net/http"
	"sync"
	"time"

	"myAiRouter/internal/gateway/context"
)

type userLimiter struct {
	tokens    float64
	lastCheck time.Time
}

var (
	limitersMu sync.Mutex
	limiters   = make(map[string]*userLimiter)
)

func RateLimit(ctx *context.GatewayContext, next HandlerFunc) error {
	limitersMu.Lock()
	lim, exists := limiters[ctx.UserID]
	if !exists {
		lim = &userLimiter{
			tokens:    60.0, // 60 requests max capacity
			lastCheck: time.Now(),
		}
		limiters[ctx.UserID] = lim
	}

	// Replenish: 1 token per second (up to 60)
	now := time.Now()
	elapsed := now.Sub(lim.lastCheck).Seconds()
	lim.tokens += elapsed * 1.0
	if lim.tokens > 60.0 {
		lim.tokens = 60.0
	}
	lim.lastCheck = now

	if lim.tokens < 1.0 {
		limitersMu.Unlock()
		ctx.WriteError(http.StatusTooManyRequests, "Rate limit exceeded (max 60/min).")
		ctx.AddStep("Rate Limit", "failed", "Rate limit exceeded")
		return nil
	}

	lim.tokens -= 1.0
	limitersMu.Unlock()

	ctx.AddStep("Rate Limit", "success", "Rate limit checked")
	return next(ctx)
}
