package analyzers

import (
	"encoding/json"
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/registry"
	"strings"
)

type ContentAnalyzer struct{}

func (a *ContentAnalyzer) Analyze(ctx *optimizer.OptimizationContext) error {
	var fullText strings.Builder
	for _, m := range ctx.Messages {
		if msgMap, ok := m.(map[string]interface{}); ok {
			if content, ok := msgMap["content"].(string); ok {
				fullText.WriteString(content)
				fullText.WriteString("\n")
			}
		}
	}

	text := fullText.String()
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		ctx.ContentType = "text"
		return nil
	}

	// 1. Check for JSON
	if (strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}")) ||
		(strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]")) {
		var js json.RawMessage
		if json.Unmarshal([]byte(trimmed), &js) == nil {
			ctx.HasJSON = true
			ctx.ContentType = "json"
		}
	}

	// 2. Check for Logs
	logIndicators := []string{"ERROR", "WARN", "INFO", "DEBUG", "FATAL", "commit ", "diff --git"}
	hasLogIndicators := false
	for _, ind := range logIndicators {
		if strings.Contains(text, ind) {
			hasLogIndicators = true
			break
		}
	}
	if hasLogIndicators {
		ctx.HasLogs = true
		if ctx.ContentType == "" {
			ctx.ContentType = "log"
		}
	}

	// 3. Check for Code
	codeIndicators := []string{"def ", "class ", "function ", "import ", "const ", "let ", "func ", "fn ", "pub ", "package ", "struct ", "interface "}
	hasCodeIndicators := false
	for _, ind := range codeIndicators {
		if strings.Contains(text, ind) {
			hasCodeIndicators = true
			break
		}
	}
	if hasCodeIndicators {
		ctx.HasCode = true
		if ctx.ContentType == "" {
			ctx.ContentType = "code"
		}
	}

	// 4. Check for Markdown
	markdownIndicators := []string{"\n# ", "**", "\n- ", "\n* ", "```"}
	hasMarkdownIndicators := false
	for _, ind := range markdownIndicators {
		if strings.Contains(text, ind) {
			hasMarkdownIndicators = true
			break
		}
	}
	if hasMarkdownIndicators {
		ctx.HasMarkdown = true
		if ctx.ContentType == "" {
			ctx.ContentType = "markdown"
		}
	}

	// 5. Scan for Secrets (high-entropy tokens)
	words := strings.Fields(text)
	for _, w := range words {
		if len(w) >= 20 && !strings.Contains(w, " ") {
			if ComputeEntropy(w) >= 0.85 {
				ctx.HasSecrets = true
				break
			}
		}
	}

	// Set fallback ContentType
	if ctx.ContentType == "" {
		if ctx.HasJSON && ctx.HasCode {
			ctx.ContentType = "mixed"
		} else {
			ctx.ContentType = "text"
		}
	}

	// Calculate Estimated Tokens
	ctx.EstimatedTokens = EstimateMessageListTokens(ctx.Messages)

	return nil
}

func init() {
	registry.RegisterAnalyzer(&ContentAnalyzer{})
}
