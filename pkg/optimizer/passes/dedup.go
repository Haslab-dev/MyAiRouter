package passes

import (
	"fmt"
	"regexp"
	"strings"

	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/analyzers"
	"myAiRouter/pkg/optimizer/registry"
)

type DedupPass struct{}

func (p *DedupPass) Name() string        { return "dedup" }
func (p *DedupPass) Version() string     { return "v1" }
func (p *DedupPass) Category() string    { return "formatting" }
func (p *DedupPass) Description() string { return "Collapses duplicate log or terminal lines with pattern matching" }

func (p *DedupPass) CanRun(ctx *optimizer.OptimizationContext) bool {
	return ctx.HasLogs
}

func (p *DedupPass) Requires() []string { return nil }
func (p *DedupPass) Before() []string   { return nil }
func (p *DedupPass) After() []string    { return []string{"structure", "tool"} }

func (p *DedupPass) Run(ctx *optimizer.OptimizationContext) (optimizer.PassResult, error) {
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

	threshold := 3
	if ctx.Goal == "accuracy" {
		threshold = 100
	} else if ctx.Profile.Name == "lite" {
		threshold = 10
	} else if ctx.Profile.Name == "extreme" || ctx.Goal == "cost" {
		threshold = 1
	}

	changedCount := 0
	initialBytes := analyzers.CalculateBytes(clonedMessages)

	for _, m := range clonedMessages {
		msgMap, ok := m.(map[string]interface{})
		if !ok {
			continue
		}

		contentStr, ok := msgMap["content"].(string)
		if !ok {
			continue
		}

		originalLen := len(contentStr)
		if len(contentStr) < 200 {
			continue
		}

		deduped := dedupLogWithThreshold(contentStr, threshold)
		if len(deduped) < originalLen {
			msgMap["content"] = deduped
			changedCount++
		}
	}

	finalBytes := analyzers.CalculateBytes(clonedMessages)

	return optimizer.PassResult{
		Messages: clonedMessages,
		Success:  true,
		Rollback: false,
		Action: optimizer.ExplainAction{
			Pass:   p.Name(),
			Action: "collapsed_duplicates",
			Details: map[string]interface{}{
				"changedMessages": changedCount,
				"bytesSaved":      initialBytes - finalBytes,
				"threshold":       threshold,
			},
		},
	}, nil
}

func dedupLogWithThreshold(input string, threshold int) string {
	lines := strings.Split(input, "\n")
	if len(lines) < 10 {
		return input
	}

	var result []string
	n := len(lines)
	i := 0

	for i < n {
		line := lines[i]
		trimmed := strings.TrimSpace(line)
		if len(trimmed) == 0 {
			result = append(result, line)
			i++
			continue
		}

		abstracted := regexp.MustCompile(`\d`).ReplaceAllString(trimmed, "X")

		j := i + 1
		for j < n {
			nextTrimmed := strings.TrimSpace(lines[j])
			if len(nextTrimmed) == 0 {
				break
			}
			nextAbstracted := regexp.MustCompile(`\d`).ReplaceAllString(nextTrimmed, "X")
			if nextAbstracted != abstracted {
				break
			}
			j++
		}

		repeatCount := j - i
		if repeatCount > threshold {
			result = append(result, lines[i])
			if repeatCount > 1 && i+1 < n && strings.TrimSpace(lines[i+1]) != "" {
				// verify it doesn't cross boundary
				nextAbstracted := regexp.MustCompile(`\d`).ReplaceAllString(strings.TrimSpace(lines[i+1]), "X")
				if nextAbstracted == abstracted {
					result = append(result, lines[i+1])
				}
			}
			// display clean repetition message
			result = append(result, fmt.Sprintf("... (repeated %d times)", repeatCount-2))
		} else {
			for k := i; k < j; k++ {
				result = append(result, lines[k])
			}
		}
		i = j
	}

	return strings.Join(result, "\n")
}

func init() {
	registry.RegisterPass(&DedupPass{})
}
