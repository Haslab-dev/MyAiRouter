package validators

import (
	"encoding/json"
	"fmt"
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/registry"
	"strings"
)

type JsonValidator struct{}

func (v *JsonValidator) Name() string { return "json" }

func (v *JsonValidator) Verify(ctx *optimizer.OptimizationContext, beforeMessages, afterMessages []interface{}) error {
	for i, m := range afterMessages {
		msgMap, ok := m.(map[string]interface{})
		if !ok {
			continue
		}

		if contentStr, ok := msgMap["content"].(string); ok {
			trimmed := strings.TrimSpace(contentStr)
			if (strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}")) ||
				(strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]")) {
				if !json.Valid([]byte(trimmed)) {
					return fmt.Errorf("message %d contains corrupted/invalid JSON syntax", i)
				}
			}
		}
	}
	return nil
}

func init() {
	registry.RegisterValidator(&JsonValidator{})
}
