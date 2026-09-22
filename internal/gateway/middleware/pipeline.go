package middleware

import "myAiRouter/internal/gateway/context"

type Middleware func(ctx *context.GatewayContext, next HandlerFunc) error
type HandlerFunc func(ctx *context.GatewayContext) error

type Pipeline struct {
	middlewares []Middleware
}

func NewPipeline() *Pipeline {
	return &Pipeline{middlewares: make([]Middleware, 0)}
}

func (p *Pipeline) Use(m Middleware) {
	p.middlewares = append(p.middlewares, m)
}

func (p *Pipeline) Run(ctx *context.GatewayContext) error {
	// The context must be THREADED through the chain, not captured: Retry
	// spawns goroutines that call next with a child context (one per combo
	// target). Ignoring that argument made every parallel branch operate on
	// the parent context, which produced concurrent map writes on
	// ctx.Metadata (a fatal, unrecoverable crash) and nil-connection
	// panics — the "myairouter dies on its own" symptom.
	var exec func(c *context.GatewayContext, idx int) error
	exec = func(c *context.GatewayContext, idx int) error {
		if idx >= len(p.middlewares) {
			return nil
		}
		return p.middlewares[idx](c, func(nextCtx *context.GatewayContext) error {
			if nextCtx == nil {
				nextCtx = c
			}
			return exec(nextCtx, idx+1)
		})
	}
	return exec(ctx, 0)
}
