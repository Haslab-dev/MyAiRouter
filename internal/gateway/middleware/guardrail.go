package middleware

import (
	"net/http"
	"strings"

	"myAiRouter/internal/gateway/context"
)

func Guardrail(ctx *context.GatewayContext, next HandlerFunc) error {
	ctx.AddStep("Guardrail", "started", "Validating request against safety guardrails")

	messages, ok := ctx.RequestBody["messages"].([]interface{})
	if ok {
		for _, msg := range messages {
			if m, ok := msg.(map[string]interface{}); ok {
				if content, ok := m["content"].(string); ok {
					// Dummy safety policy block trigger
					if strings.Contains(strings.ToLower(content), "malicious injection payload") {
						ctx.WriteError(http.StatusBadRequest, "Request blocked by guardrails: detected potential prompt injection pattern.")
						ctx.AddStep("Guardrail", "failed", "Safety violation: potential prompt injection detected")
						return nil
					}
				}
			}
		}
	}

	ctx.AddStep("Guardrail", "success", "Safety checks passed")
	return next(ctx)
}
