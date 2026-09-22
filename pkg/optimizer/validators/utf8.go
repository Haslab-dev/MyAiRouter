package validators

import (
	"fmt"
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/registry"
	"unicode/utf8"
)

type Utf8Validator struct{}

func (v *Utf8Validator) Name() string { return "utf8" }

func (v *Utf8Validator) Verify(ctx *optimizer.OptimizationContext, beforeMessages, afterMessages []interface{}) error {
	for i, m := range afterMessages {
		msgMap, ok := m.(map[string]interface{})
		if !ok {
			continue
		}

		if contentStr, ok := msgMap["content"].(string); ok {
			if !utf8.ValidString(contentStr) {
				return fmt.Errorf("message %d contains invalid UTF-8 string coding", i)
			}
		}
	}
	return nil
}

func init() {
	registry.RegisterValidator(&Utf8Validator{})
}
