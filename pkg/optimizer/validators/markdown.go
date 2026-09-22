package validators

import (
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/registry"
)

type MarkdownValidator struct{}

func (v *MarkdownValidator) Name() string { return "markdown" }

func (v *MarkdownValidator) Verify(ctx *optimizer.OptimizationContext, beforeMessages, afterMessages []interface{}) error {
	return nil
}

func init() {
	registry.RegisterValidator(&MarkdownValidator{})
}
