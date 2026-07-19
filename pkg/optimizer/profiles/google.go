package profiles

import (
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/registry"
)

func init() {
	registry.RegisterProfile(optimizer.ProviderProfile{
		Name:            "google",
		MaxInputTokens:  1000000,
		SupportsSystem:  true,
		SystemSafeLimit: 30000,
	})
}
