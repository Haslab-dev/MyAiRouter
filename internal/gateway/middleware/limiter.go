package middleware

import (
	"net/http"
	"sync"
	"time"

	"myAiRouter/internal/gateway/context"
)

type userLimiter struct {
	mu        sync.Mutex
	tokens    float64
	lastCheck time.Time
}

// Per-user limiters live in a sharded map so the hot path never serializes on
// one global mutex; each bucket has its own lock.
var limiters sync.Map // string -> *userLimiter

func RateLimit(ctx *context.GatewayContext, next HandlerFunc) error {
	val, _ := limiters.LoadOrStore(ctx.UserID, &userLimiter{tokens: 60.0, lastCheck: time.Now()})
	lim := val.(*userLimiter)

	allowed := true
	lim.mu.Lock()
	// Replenish: 1 token per second (up to 60)
	now := time.Now()
	elapsed := now.Sub(lim.lastCheck).Seconds()
	lim.tokens += elapsed * 1.0
	if lim.tokens > 60.0 {
		lim.tokens = 60.0
	}
	lim.lastCheck = now

	if lim.tokens < 1.0 {
		allowed = false
	} else {
		lim.tokens -= 1.0
	}
	lim.mu.Unlock()

	if !allowed {
		ctx.WriteError(http.StatusTooManyRequests, "Rate limit exceeded (max 60/min).")
		ctx.AddStep("Rate Limit", "failed", "Rate limit exceeded")
		return nil
	}

	ctx.AddStep("Rate Limit", "success", "Rate limit checked")
	return next(ctx)
}
