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
	var exec func(idx int) error
	exec = func(idx int) error {
		if idx >= len(p.middlewares) {
			return nil
		}
		return p.middlewares[idx](ctx, func(c *context.GatewayContext) error {
			return exec(idx + 1)
		})
	}
	return exec(0)
}
