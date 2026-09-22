package passes

import (
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/analyzers"
	"myAiRouter/pkg/optimizer/registry"
	"myAiRouter/pkg/rtk"
)

type ToolPass struct{}

func (p *ToolPass) Name() string        { return "tool" }
func (p *ToolPass) Version() string     { return "v1" }
func (p *ToolPass) Category() string    { return "tool" }
func (p *ToolPass) Description() string { return "Formats console tool outputs dynamically to strip redundancy" }

func (p *ToolPass) CanRun(ctx *optimizer.OptimizationContext) bool {
	return ctx.HasLogs
}

func (p *ToolPass) Requires() []string { return nil }
func (p *ToolPass) Before() []string   { return []string{"structure"} }
func (p *ToolPass) After() []string    { return nil }

func (p *ToolPass) Run(ctx *optimizer.OptimizationContext) (optimizer.PassResult, error) {
	clonedMessages := make([]interface{}, len(ctx.Messages))
	for i, m := range ctx.Messages {
		if msgMap, ok := m.(map[string]interface{}); ok {
			clonedMsg := make(map[string]interface{})
			for k, v := range msgMap {
				clonedMsg[k] = v
			}
			clonedMessages[i] = clonedMsg
		} else {
			clonedMessages[i] = m
		}
	}

	changedCount := 0
	initialBytes := analyzers.CalculateBytes(clonedMessages)

	for _, m := range clonedMessages {
		msgMap, ok := m.(map[string]interface{})
		if !ok {
			continue
		}

		if role := msgMap["role"]; role == "tool" {
			if contentStr, ok := msgMap["content"].(string); ok {
				compressed := rtkCompressText(contentStr)
				if compressed != contentStr {
					msgMap["content"] = compressed
					changedCount++
				}
			}
		}

		if contentArr, ok := msgMap["content"].([]interface{}); ok {
			for _, part := range contentArr {
				pMap, ok := part.(map[string]interface{})
				if !ok {
					continue
				}
				if pMap["type"] == "tool_result" {
					if contentStr, ok := pMap["content"].(string); ok {
						compressed := rtkCompressText(contentStr)
						if compressed != contentStr {
							pMap["content"] = compressed
							changedCount++
						}
					}
				}
			}
		}
	}

	finalBytes := analyzers.CalculateBytes(clonedMessages)

	return optimizer.PassResult{
		Messages: clonedMessages,
		Success:  true,
		Rollback: false,
		Action: optimizer.ExplainAction{
			Pass:   p.Name(),
			Action: "formatted_tool_outputs",
			Details: map[string]interface{}{
				"changedMessages": changedCount,
				"bytesSaved":      initialBytes - finalBytes,
			},
		},
	}, nil
}

func rtkCompressText(text string) string {
	if len(text) < 100 {
		return text
	}
	filter := rtk.AutoDetectFilter(text)
	if filter == nil {
		return text
	}
	compressed := filter(text)
	if len(compressed) == 0 || len(compressed) >= len(text) {
		return text
	}
	return compressed
}

func init() {
	registry.RegisterPass(&ToolPass{})
}
