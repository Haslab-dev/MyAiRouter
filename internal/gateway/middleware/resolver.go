package middleware

import (
	"fmt"
	"net/http"
	"strings"

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
	combo, err := db.GetComboByName(modelStr)
	if err == nil && combo != nil && len(combo.Models) > 0 {
		ctx.Metadata["modelsToTry"] = combo.Models
		ctx.AddStep("Model Resolver", "success", fmt.Sprintf("Resolved combo '%s' to: %s", modelStr, strings.Join(combo.Models, ", ")))
	} else {
		ctx.Metadata["modelsToTry"] = []string{modelStr}
		ctx.AddStep("Model Resolver", "success", fmt.Sprintf("Resolved model name: %s", modelStr))
	}

	return next(ctx)
}
