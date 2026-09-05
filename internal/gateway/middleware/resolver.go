package middleware

import (
	"fmt"
	"net/http"

	"myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
)

func ModelResolver(ctx *context.GatewayContext, next HandlerFunc) error {
	body := ctx.RequestBody
	modelStr, _ := body["model"].(string)
	if modelStr == "" {
		ctx.WriteError(http.StatusBadRequest, "Missing model parameter in request body")
		ctx.AddStep("Model Resolver", "failed", "Missing model parameter")
		return nil
	}

	ctx.OriginalModel = modelStr

	// Resolve model combo or single target model
	combo, err := db.ResolveCombo(modelStr)
	if err == nil && combo != nil && len(combo.Models) > 0 {
		ctx.Metadata["modelsToTry"] = combo.Models
		ctx.Metadata["comboKind"] = combo.Kind
		ctx.Metadata["comboName"] = combo.Name
		ctx.Metadata["isCombo"] = true
		ctx.Metadata["attemptPolicy"] = combo.Policy.Normalized()
		ctx.AddStep("Model Resolver", "success", fmt.Sprintf("Resolved combo route '%s' (kind: %s) with %d models", combo.Name, combo.Kind, len(combo.Models)))
	} else {
		ctx.Metadata["modelsToTry"] = []string{modelStr}
		ctx.Metadata["comboKind"] = "direct"
		ctx.Metadata["isCombo"] = false
		ctx.AddStep("Model Resolver", "success", fmt.Sprintf("Direct single model call: %s", modelStr))
	}

	return next(ctx)
}
