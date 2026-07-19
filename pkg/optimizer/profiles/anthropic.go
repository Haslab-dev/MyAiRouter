package profiles

import (
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/registry"
)

func init() {
	registry.RegisterProfile(optimizer.ProviderProfile{
		Name:            "anthropic",
		MaxInputTokens:  200000,
		SupportsSystem:  true,
		SystemSafeLimit: 15000,
	})
}
