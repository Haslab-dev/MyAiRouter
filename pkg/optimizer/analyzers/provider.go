package analyzers

import (
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/registry"
)

type ProviderAnalyzer struct{}

func (a *ProviderAnalyzer) Analyze(ctx *optimizer.OptimizationContext) error {
	if ctx.Metadata == nil {
		ctx.Metadata = make(map[string]interface{})
	}
	ctx.Metadata["sniffedProvider"] = ctx.Provider
	ctx.Metadata["sniffedModel"] = ctx.Model
	return nil
}

func init() {
	registry.RegisterAnalyzer(&ProviderAnalyzer{})
}
