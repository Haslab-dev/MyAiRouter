package analyzers

import (
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/registry"
	"strings"
)

type LanguageAnalyzer struct{}

var languageMarkers = map[string][]string{
	"python":     {"def ", "import ", "from ", "class ", "async def"},
	"javascript": {"function ", "const ", "let ", "var ", "=>"},
	"typescript": {"interface ", "type ", ": string", ": number"},
	"go":         {"func ", "package ", "import (", "type "},
	"rust":       {"fn ", "let mut", "impl ", "pub fn", "use "},
	"java":       {"public class", "private ", "protected ", "void "},
}

func (a *LanguageAnalyzer) Analyze(ctx *optimizer.OptimizationContext) error {
	if !ctx.HasCode {
		return nil
	}

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

	scores := make(map[string]int)
	maxScore := 0
	detectedLang := "python" // default fallback

	for lang, patterns := range languageMarkers {
		score := 0
		for _, p := range patterns {
			if strings.Contains(text, p) {
				score++
			}
		}
		scores[lang] = score
		if score > maxScore {
			maxScore = score
			detectedLang = lang
		}
	}

	if maxScore > 0 {
		ctx.Language = detectedLang
	} else {
		ctx.Language = "python" // Default fallback
	}

	return nil
}

func init() {
	registry.RegisterAnalyzer(&LanguageAnalyzer{})
}
