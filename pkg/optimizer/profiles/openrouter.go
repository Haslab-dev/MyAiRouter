package profiles

import (
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/registry"
)

func init() {
	registry.RegisterProfile(optimizer.ProviderProfile{
		Name:            "openrouter",
		MaxInputTokens:  128000,
		SupportsSystem:  true,
		SystemSafeLimit: 10000,
	})
}
