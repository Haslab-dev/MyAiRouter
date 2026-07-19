package validators

import (
	"fmt"
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/analyzers"
	"myAiRouter/pkg/optimizer/registry"
)

type InflationValidator struct{}

func (v *InflationValidator) Name() string { return "inflation" }

func (v *InflationValidator) Verify(ctx *optimizer.OptimizationContext, beforeMessages, afterMessages []interface{}) error {
	beforeTokens := analyzers.EstimateMessageListTokens(beforeMessages)
	afterTokens := analyzers.EstimateMessageListTokens(afterMessages)

	if afterTokens > beforeTokens {
		return fmt.Errorf("token size inflated from %d to %d", beforeTokens, afterTokens)
	}
	return nil
}

func init() {
	registry.RegisterValidator(&InflationValidator{})
}
