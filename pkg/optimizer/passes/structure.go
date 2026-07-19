package passes

import (
	"fmt"
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/analyzers"
	"myAiRouter/pkg/optimizer/registry"
	"regexp"
	"strings"
)

type jsonTokenType int

const (
	tokenKey jsonTokenType = iota
	tokenStringValue
	tokenNumber
	tokenBoolean
	tokenNull
	tokenBracket
	tokenColon
	tokenComma
	tokenWhitespace
)

type jsonToken struct {
	text      string
	tokenType jsonTokenType
	start     int
	end       int
}

type StructurePass struct{}

func (p *StructurePass) Name() string    { return "structure" }
func (p *StructurePass) Version() string { return "v1" }
func (p *StructurePass) Category() string {
	return "structural"
}
func (p *StructurePass) Description() string {
	return "Structure-preserves JSON schemas, code signature declarations, and high-entropy secret variables"
}

func (p *StructurePass) CanRun(ctx *optimizer.OptimizationContext) bool {
	return true
}

func (p *StructurePass) Requires() []string { return nil }
func (p *StructurePass) Before() []string   { return []string{"dedup", "markdown"} }
func (p *StructurePass) After() []string    { return []string{"tool"} }

func (p *StructurePass) Run(ctx *optimizer.OptimizationContext) (optimizer.PassResult, error) {
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

	skipStructural := ctx.Goal == "accuracy" || ctx.Profile.Name == "lite"
	if skipStructural {
		return optimizer.PassResult{
			Messages: clonedMessages,
			Success:  true,
			Rollback: false,
			Action: optimizer.ExplainAction{
				Pass:    p.Name(),
				Action:  "structure_preservation_skipped",
				Details: map[string]interface{}{"message": "Skipped under Maximum Accuracy goal or Lite profile"},
			},
		}, nil
	}

	shouldPruneCode := ctx.Profile.Name == "aggressive" || ctx.Profile.Name == "extreme" || ctx.Goal == "cost" || ctx.Goal == "savings"
	preserveLimit := 20
	if ctx.Profile.Name == "extreme" || ctx.Goal == "cost" {
		preserveLimit = 15
	} else if ctx.Profile.Name == "balanced" || ctx.Goal == "balanced" {
		preserveLimit = 80
	}

	compressedCount := 0
	initialBytes := analyzers.CalculateBytes(clonedMessages)

	// Compress the last message if it's single-turn or we have extreme/aggressive profiles
	limit := len(clonedMessages)
	if ctx.Profile.Name != "extreme" && ctx.Profile.Name != "aggressive" && len(clonedMessages) > 1 {
		limit = len(clonedMessages) - 1
	}

	for i := 0; i < limit; i++ {
		msgMap, ok := clonedMessages[i].(map[string]interface{})
		if !ok {
			continue
		}

		role := msgMap["role"]
		if role == "assistant" {
			continue
		}

		contentStr, ok := msgMap["content"].(string)
		if !ok {
			continue
		}

		if len(contentStr) < 200 { // Skip short messages
			continue
		}

		var compressed string
		var count int

		if strings.Contains(contentStr, "```") {
			compressed, count = compressCodeBlocks(contentStr, ctx.Profile.TargetRatio, shouldPruneCode, preserveLimit)
		} else if ctx.HasJSON && (strings.HasPrefix(strings.TrimSpace(contentStr), "{") || strings.HasPrefix(strings.TrimSpace(contentStr), "[")) {
			compressed, count = compressJSON(contentStr, ctx.Profile.TargetRatio, preserveLimit)
		} else if ctx.HasCode {
			if shouldPruneCode {
				compressed, count = compressCode(contentStr, ctx.Language, ctx.Profile.TargetRatio)
			} else {
				compressed = contentStr
			}
		} else {
			compressed = middleTruncate(contentStr, ctx.Profile.TargetRatio)
			if compressed != contentStr {
				count = 1
			}
		}

		if len(compressed) < len(contentStr) {
			msgMap["content"] = compressed
			compressedCount += count
		}
	}

	finalBytes := analyzers.CalculateBytes(clonedMessages)

	return optimizer.PassResult{
		Messages: clonedMessages,
		Success:  true,
		Rollback: false,
		Action: optimizer.ExplainAction{
			Pass:   p.Name(),
			Action: "structure_preservation",
			Details: map[string]interface{}{
				"compressedBlocks": compressedCount,
				"bytesSaved":       initialBytes - finalBytes,
			},
		},
	}, nil
}

func tokenizeJSON(content string) []jsonToken {
	var tokens []jsonToken
	i := 0
	n := len(content)

	expectKey := false
	var braceStack []string

	for i < n {
		char := content[i]

		if char == ' ' || char == '\t' || char == '\n' || char == '\r' {
			start := i
			for i < n && (content[i] == ' ' || content[i] == '\t' || content[i] == '\n' || content[i] == '\r') {
				i++
			}
			tokens = append(tokens, jsonToken{content[start:i], tokenWhitespace, start, i})
			continue
		}

		if char == '{' || char == '}' || char == '[' || char == ']' {
			tokens = append(tokens, jsonToken{string(char), tokenBracket, i, i + 1})
			if char == '{' {
				braceStack = append(braceStack, "{")
				expectKey = true
			} else if char == '}' {
				if len(braceStack) > 0 && braceStack[len(braceStack)-1] == "{" {
					braceStack = braceStack[:len(braceStack)-1]
				}
				expectKey = false
			} else if char == '[' {
				braceStack = append(braceStack, "[")
				expectKey = false
			} else if char == ']' {
				if len(braceStack) > 0 && braceStack[len(braceStack)-1] == "[" {
					braceStack = braceStack[:len(braceStack)-1]
				}
			}
			i++
			continue
		}

		if char == ':' {
			tokens = append(tokens, jsonToken{":", tokenColon, i, i + 1})
			expectKey = false
			i++
			continue
		}

		if char == ',' {
			tokens = append(tokens, jsonToken{",", tokenComma, i, i + 1})
			if len(braceStack) > 0 && braceStack[len(braceStack)-1] == "{" {
				expectKey = true
			}
			i++
			continue
		}

		if char == '"' {
			start := i
			i++
			for i < n && content[i] != '"' {
				if content[i] == '\\' {
					i += 2
				} else {
					i++
				}
			}
			if i < n {
				i++
			}

			text := content[start:i]

			j := i
			for j < n && (content[j] == ' ' || content[j] == '\t' || content[j] == '\n' || content[j] == '\r') {
				j++
			}

			isKey := j < n && content[j] == ':' && expectKey

			if isKey {
				tokens = append(tokens, jsonToken{text, tokenKey, start, i})
				expectKey = false
			} else {
				tokens = append(tokens, jsonToken{text, tokenStringValue, start, i})
			}
			continue
		}

		if char == '-' || (char >= '0' && char <= '9') {
			start := i
			if char == '-' {
				i++
			}
			for i < n && content[i] >= '0' && content[i] <= '9' {
				i++
			}
			if i < n && content[i] == '.' {
				i++
				for i < n && content[i] >= '0' && content[i] <= '9' {
					i++
				}
			}
			if i < n && (content[i] == 'e' || content[i] == 'E') {
				i++
				if i < n && (content[i] == '+' || content[i] == '-') {
					i++
				}
				for i < n && content[i] >= '0' && content[i] <= '9' {
					i++
				}
			}
			tokens = append(tokens, jsonToken{content[start:i], tokenNumber, start, i})
			continue
		}

		if i+4 <= n && content[i:i+4] == "true" {
			tokens = append(tokens, jsonToken{"true", tokenBoolean, i, i + 4})
			i += 4
			continue
		}
		if i+5 <= n && content[i:i+5] == "false" {
			tokens = append(tokens, jsonToken{"false", tokenBoolean, i, i + 5})
			i += 5
			continue
		}
		if i+4 <= n && content[i:i+4] == "null" {
			tokens = append(tokens, jsonToken{"null", tokenNull, i, i + 4})
			i += 4
			continue
		}

		i++
	}

	return tokens
}

func compressJSON(content string, targetRatio float64, preserveLimit int) (string, int) {
	tokens := tokenizeJSON(content)
	mask := make([]bool, len(content))

	var containerStack []string
	var arrayItemStack []int

	for _, token := range tokens {
		if token.tokenType == tokenBracket {
			if token.text == "{" || token.text == "[" {
				containerStack = append(containerStack, token.text)
				if token.text == "[" {
					arrayItemStack = append(arrayItemStack, 0)
				}
			} else if token.text == "}" {
				if len(containerStack) > 0 && containerStack[len(containerStack)-1] == "{" {
					containerStack = containerStack[:len(containerStack)-1]
				}
			} else if token.text == "]" {
				if len(containerStack) > 0 && containerStack[len(containerStack)-1] == "[" {
					containerStack = containerStack[:len(containerStack)-1]
					if len(arrayItemStack) > 0 {
						arrayItemStack = arrayItemStack[:len(arrayItemStack)-1]
					}
				}
			}
		}

		if token.tokenType == tokenComma &&
			len(containerStack) > 0 &&
			containerStack[len(containerStack)-1] == "[" &&
			len(arrayItemStack) > 0 {
			arrayItemStack[len(arrayItemStack)-1]++
		}

		preserve := false

		if token.tokenType == tokenBracket ||
			token.tokenType == tokenKey ||
			token.tokenType == tokenColon ||
			token.tokenType == tokenComma ||
			token.tokenType == tokenBoolean ||
			token.tokenType == tokenNull {
			preserve = true
		} else if token.tokenType == tokenNumber {
			preserve = len(token.text) <= 10
		} else if token.tokenType == tokenStringValue {
			depth := len(arrayItemStack)
			itemIndex := 0
			if depth > 0 {
				itemIndex = arrayItemStack[depth-1]
			}

			if depth > 0 && itemIndex >= 3 {
				preserve = false
			} else {
				val := strings.Trim(token.text, "\"")
				if len(val) <= preserveLimit {
					preserve = true
				} else if !strings.Contains(val, " ") {
					if analyzers.ComputeEntropy(val) >= 0.85 {
						preserve = true
					}
				}
			}
		}

		if preserve {
			for idx := token.start; idx < token.end && idx < len(mask); idx++ {
				mask[idx] = true
			}
		}
	}

	var sb strings.Builder
	i := 0
	compressedCount := 0

	for i < len(content) {
		if mask[i] {
			start := i
			for i < len(content) && mask[i] {
				i++
			}
			sb.WriteString(content[start:i])
		} else {
			start := i
			for i < len(content) && !mask[i] {
				i++
			}
			spanText := content[start:i]
			if len(spanText) > 50 {
				compressed := middleTruncate(spanText, targetRatio)
				sb.WriteString(compressed)
				compressedCount++
			} else {
				sb.WriteString(spanText)
			}
		}
	}

	return sb.String(), compressedCount
}

func compressCode(content string, language string, targetRatio float64) (string, int) {
	mask := make([]bool, len(content))

	sigPatterns := signaturePatterns[language]
	importPattern := importPatterns[language]

	if importPattern != nil {
		matches := importPattern.FindAllStringIndex(content, -1)
		for _, m := range matches {
			start, end := m[0], m[1]
			lineEnd := strings.Index(content[end:], "\n")
			if lineEnd != -1 {
				end = end + lineEnd
			} else {
				end = len(content)
			}
			for idx := start; idx < end; idx++ {
				mask[idx] = true
			}
		}
	}

	for _, pat := range sigPatterns {
		matches := pat.FindAllStringIndex(content, -1)
		for _, m := range matches {
			for idx := m[0]; idx < m[1]; idx++ {
				mask[idx] = true
			}
		}
	}

	words := strings.Fields(content)
	for _, w := range words {
		if len(w) >= 20 && !strings.Contains(w, " ") {
			if analyzers.ComputeEntropy(w) >= 0.85 {
				idx := strings.Index(content, w)
				if idx != -1 {
					for charIdx := idx; charIdx < idx+len(w); charIdx++ {
						mask[charIdx] = true
					}
				}
			}
		}
	}

	var sb strings.Builder
	i := 0
	compressedCount := 0

	for i < len(content) {
		if mask[i] {
			start := i
			for i < len(content) && mask[i] {
				i++
			}
			sb.WriteString(content[start:i])
		} else {
			start := i
			for i < len(content) && !mask[i] {
				i++
			}
			spanText := content[start:i]
			if len(spanText) > 50 {
				omittedLines := strings.Count(spanText, "\n")
				if omittedLines < 1 {
					omittedLines = 1
				}

				commentMarker := ""
				switch language {
				case "python", "ruby", "shell", "bash", "yaml", "dockerfile":
					commentMarker = fmt.Sprintf("\n# <%d lines of implementation omitted>\n", omittedLines)
				default:
					commentMarker = fmt.Sprintf("\n// <%d lines of implementation omitted>\n", omittedLines)
				}
				sb.WriteString(commentMarker)
				compressedCount++
			} else {
				sb.WriteString(spanText)
			}
		}
	}

	return sb.String(), compressedCount
}

func middleTruncate(text string, targetRatio float64) string {
	runes := []rune(text)
	targetLen := int(float64(len(runes)) * targetRatio)
	if len(runes) <= targetLen || targetLen <= 20 {
		return text
	}

	keepStart := targetLen * 2 / 3
	keepEnd := targetLen / 3
	marker := " ...[compressed]... "

	if keepStart+keepEnd+len([]rune(marker)) >= len(runes) {
		return text
	}

	return string(runes[:keepStart]) + marker + string(runes[len(runes)-keepEnd:])
}

var signaturePatterns = map[string][]*regexp.Regexp{
	"python": {
		regexp.MustCompile(`(?m)^\s*(async\s+)?def\s+\w+\s*\([^)]*\)\s*(->\s*[^:]+)?:`),
		regexp.MustCompile(`(?m)^\s*class\s+\w+(\([^)]*\))?:`),
		regexp.MustCompile(`(?m)^\s*@\w+(\([^)]*\))?\s*$`),
	},
	"javascript": {
		regexp.MustCompile(`(?m)^\s*(async\s+)?function\s+\w+\s*\([^)]*\)`),
		regexp.MustCompile(`(?m)^\s*class\s+\w+(\s+extends\s+\w+)?`),
		regexp.MustCompile(`(?m)^\s*(const|let|var)\s+\w+\s*=\s*(async\s+)?\([^)]*\)\s*=>`),
	},
	"typescript": {
		regexp.MustCompile(`(?m)^\s*(async\s+)?function\s+\w+\s*(<[^>]+>)?\s*\([^)]*\)`),
		regexp.MustCompile(`(?m)^\s*class\s+\w+(<[^>]+>)?(\s+extends\s+\w+)?`),
		regexp.MustCompile(`(?m)^\s*interface\s+\w+(<[^>]+>)?`),
		regexp.MustCompile(`(?m)^\s*type\s+\w+(<[^>]+>)?\s*=`),
	},
	"go": {
		regexp.MustCompile(`(?m)^\s*func\s+(\([^)]+\)\s+)?\w+\s*\([^)]*\)`),
		regexp.MustCompile(`(?m)^\s*type\s+\w+\s+(struct|interface)`),
	},
	"rust": {
		regexp.MustCompile(`(?m)^\s*(pub\s+)?(async\s+)?fn\s+\w+\s*(<[^>]+>)?\s*\([^)]*\)`),
		regexp.MustCompile(`(?m)^\s*(pub\s+)?struct\s+\w+`),
		regexp.MustCompile(`(?m)^\s*(pub\s+)?enum\s+\w+`),
		regexp.MustCompile(`(?m)^\s*(pub\s+)?trait\s+\w+`),
		regexp.MustCompile(`(?m)^\s*impl(<[^>]+>)?\s+\w+`),
	},
	"java": {
		regexp.MustCompile(`(?m)^\s*(public|private|protected)?\s*(static\s+)?\w+\s+\w+\s*\([^)]*\)`),
		regexp.MustCompile(`(?m)^\s*(public\s+)?(class|interface|enum)\s+\w+`),
		regexp.MustCompile(`(?m)^\s*@\w+(\([^)]*\))?\s*$`),
	},
}

var importPatterns = map[string]*regexp.Regexp{
	"python":     regexp.MustCompile(`(?m)^\s*(import\s+\w+|from\s+\w+\s+import)`),
	"javascript": regexp.MustCompile(`(?m)^\s*(import\s+.*from|require\s*\()`),
	"typescript": regexp.MustCompile(`(?m)^\s*(import\s+.*from|require\s*\()`),
	"go":         regexp.MustCompile(`(?m)^\s*import\s+(\(|")`),
	"rust":       regexp.MustCompile(`(?m)^\s*use\s+\w+`),
	"java":       regexp.MustCompile(`(?m)^\s*import\s+[\w.]+;`),
}

func summarizeDiff(diffText string) string {
	lines := strings.Split(diffText, "\n")
	added := 0
	deleted := 0
	files := []string{}
	additions := []string{}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "diff --git") {
			parts := strings.Fields(trimmed)
			if len(parts) >= 4 {
				file := parts[3]
				if strings.HasPrefix(file, "b/") {
					file = file[2:]
				}
				files = append(files, file)
			}
		} else if strings.HasPrefix(trimmed, "+++ ") || strings.HasPrefix(trimmed, "--- ") {
			continue
		} else if strings.HasPrefix(trimmed, "+") {
			added++
			if len(additions) < 5 {
				content := strings.TrimPrefix(trimmed, "+")
				clean := strings.TrimSpace(content)
				if len(clean) > 5 && !strings.Contains(clean, "{") {
					additions = append(additions, clean)
				}
			}
		} else if strings.HasPrefix(trimmed, "-") {
			deleted++
		}
	}

	if len(files) == 0 {
		files = append(files, "workspace files")
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("... <Git Diff: %d additions, %d deletions across %d files>\n", added, deleted, len(files)))
	sb.WriteString("Files modified:\n")
	for _, f := range files {
		sb.WriteString(fmt.Sprintf("• %s\n", f))
	}
	if len(additions) > 0 {
		sb.WriteString("Key additions:\n")
		for _, a := range additions {
			sb.WriteString(fmt.Sprintf("• %s\n", a))
		}
	}
	return sb.String()
}

func compressCodeBlocks(contentStr string, targetRatio float64, shouldPruneCode bool, preserveLimit int) (string, int) {
	re := regexp.MustCompile("(?s)```(\\w*)[^\\n]*\\n(.*?)\\r?\\n```")
	matches := re.FindAllStringSubmatchIndex(contentStr, -1)
	if len(matches) == 0 {
		return contentStr, 0
	}

	var sb strings.Builder
	lastIdx := 0
	compressedCount := 0

	for _, m := range matches {
		sb.WriteString(contentStr[lastIdx:m[0]])

		lang := ""
		if m[2] != -1 && m[3] != -1 {
			lang = contentStr[m[2]:m[3]]
		}

		innerCode := contentStr[m[4]:m[5]]
		var compressedInner string
		var count int

		trimmedLang := strings.TrimSpace(strings.ToLower(lang))
		if trimmedLang == "json" {
			compressedInner, count = compressJSON(innerCode, targetRatio, preserveLimit)
		} else if trimmedLang == "go" || trimmedLang == "python" || trimmedLang == "javascript" || trimmedLang == "typescript" || trimmedLang == "js" || trimmedLang == "ts" {
			if shouldPruneCode {
				compressedInner, count = compressCode(innerCode, trimmedLang, targetRatio)
			} else {
				compressedInner = innerCode
			}
		} else if trimmedLang == "diff" {
			compressedInner = summarizeDiff(innerCode)
			count = 1
		} else {
			compressedInner = middleTruncate(innerCode, targetRatio)
			if compressedInner != innerCode {
				count = 1
			}
		}

		sb.WriteString("```")
		sb.WriteString(lang)
		sb.WriteString("\n")
		sb.WriteString(compressedInner)
		sb.WriteString("\n```")

		compressedCount += count
		lastIdx = m[1]
	}

	sb.WriteString(contentStr[lastIdx:])

	return sb.String(), compressedCount
}

func init() {
	registry.RegisterPass(&StructurePass{})
}
