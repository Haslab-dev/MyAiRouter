package passes

import (
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/registry"
	"regexp"
	"strings"
)

type MarkdownPass struct{}

func (p *MarkdownPass) Name() string        { return "markdown" }
func (p *MarkdownPass) Version() string     { return "v1" }
func (p *MarkdownPass) Category() string    { return "formatting" }
func (p *MarkdownPass) Description() string { return "Cleans markdown spaces, trims line ends, and collapses multiple blank lines" }

func (p *MarkdownPass) CanRun(ctx *optimizer.OptimizationContext) bool {
	return ctx.HasMarkdown
}

func (p *MarkdownPass) Requires() []string { return nil }
func (p *MarkdownPass) Before() []string   { return nil }
func (p *MarkdownPass) After() []string    { return []string{"structure", "tool"} }

var htmlCommentRe = regexp.MustCompile(`(?s)<!--.*?-->`)
var multiNewlineRe = regexp.MustCompile(`\n{3,}`)

func (p *MarkdownPass) Run(ctx *optimizer.OptimizationContext) (optimizer.PassResult, error) {
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
	linesCollapsed := 0
	commentsStripped := 0

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

		strippedComments := htmlCommentRe.ReplaceAllString(contentStr, "")
		commentsStripped += (len(contentStr) - len(strippedComments))

		lines := strings.Split(strippedComments, "\n")
		for idx, line := range lines {
			lines[idx] = strings.TrimRight(line, " \t\r")
		}
		trimmedLines := strings.Join(lines, "\n")

		collapsed := multiNewlineRe.ReplaceAllString(trimmedLines, "\n\n")
		linesCollapsed += (len(trimmedLines) - len(collapsed))

		if len(collapsed) < originalLen {
			msgMap["content"] = collapsed
			changedCount++
		}
	}

	return optimizer.PassResult{
		Messages: clonedMessages,
		Success:  true,
		Rollback: false,
		Action: optimizer.ExplainAction{
			Pass:   p.Name(),
			Action: "optimized_markdown",
			Details: map[string]interface{}{
				"changedMessages":  changedCount,
				"commentsStripped": commentsStripped,
				"linesCollapsed":   linesCollapsed,
			},
		},
	}, nil
}

func init() {
	registry.RegisterPass(&MarkdownPass{})
}
