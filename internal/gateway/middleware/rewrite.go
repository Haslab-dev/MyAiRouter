package middleware

import (
	"myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
	"myAiRouter/pkg/rtk"
)

func PromptRewrite(ctx *context.GatewayContext, next HandlerFunc) error {
	ctx.AddStep("Prompt Rewrite", "started", "Executing prompt modification and personality injection")

	settings, err := db.GetSettings()
	if err == nil && settings != nil {
		format := ctx.Provider
		if format != "anthropic" && format != "gemini" {
			format = "openai"
		}
		rtk.InjectSystemPrompts(ctx.RequestBody, format, settings)
		ctx.AddStep("Prompt Rewrite", "success", "Directives successfully injected to system prompt")
	} else {
		ctx.AddStep("Prompt Rewrite", "skipped", "Settings unavailable, skipping rewrite")
	}

	return next(ctx)
}
