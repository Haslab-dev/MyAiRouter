package middleware

import (
	"fmt"
	"strings"
	"sync/atomic"

	"myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
)

type ConnectionModel struct {
	Connection db.ProviderConnection
	ModelName  string
	Provider   string
}

var loadBalanceCounter uint64

func Routing(ctx *context.GatewayContext, next HandlerFunc) error {
	modelsToTry, _ := ctx.Metadata["modelsToTry"].([]string)
	comboKind, _ := ctx.Metadata["comboKind"].(string)

	if len(modelsToTry) > 1 {
		switch comboKind {
		case "smart":
			modelsToTry = classifyAndRankModels(ctx.RequestBody, modelsToTry)
			ctx.AddStep("Routing (Smart)", "success", fmt.Sprintf("Smart classifier prioritized order: %s", strings.Join(modelsToTry, ", ")))
		case "load_balance":
			idx := int(atomic.AddUint64(&loadBalanceCounter, 1) % uint64(len(modelsToTry)))
			rotated := append([]string{}, modelsToTry[idx:]...)
			rotated = append(rotated, modelsToTry[:idx]...)
			modelsToTry = rotated
			ctx.AddStep("Routing (Load Balance)", "success", fmt.Sprintf("Round-robin selected primary model: %s", modelsToTry[0]))
		}
	}

	var targets []ConnectionModel

	for _, currentModel := range modelsToTry {
		provider := "openai"
		modelName := currentModel
		if idx := strings.Index(currentModel, "/"); idx != -1 {
			provider = currentModel[:idx]
			modelName = currentModel[idx+1:]
		}

		accounts, err := getActiveConnectionsForPrefix(provider)
		if err == nil && len(accounts) > 0 {
			for _, acc := range accounts {
				targets = append(targets, ConnectionModel{
					Connection: acc,
					ModelName:  modelName,
					Provider:   provider,
				})
			}
		}
	}

	if len(targets) == 0 {
		ctx.WriteError(503, "No active upstream connections found for requested models")
		ctx.AddStep("Routing", "failed", "No connections available")
		return nil
	}

	ctx.Metadata["routingTargets"] = targets
	ctx.AddStep("Routing", "success", fmt.Sprintf("Routed to %d possible connection nodes", len(targets)))
	return next(ctx)
}

func classifyAndRankModels(body map[string]interface{}, models []string) []string {
	var promptBuilder strings.Builder
	if msgs, ok := body["messages"].([]interface{}); ok {
		for _, item := range msgs {
			if m, ok := item.(map[string]interface{}); ok {
				if content, ok := m["content"].(string); ok {
					promptBuilder.WriteString(content)
					promptBuilder.WriteString(" ")
				}
			}
		}
	}
	prompt := strings.ToLower(promptBuilder.String())
	charCount := len(prompt)

	category := "general"
	if charCount > 8000 {
		category = "long_context"
	} else if containsAny(prompt, []string{"code", "function", "def ", "class ", "import ", "err !=", "html", "css", "script", "json", "sql", "bug", "fix", "refactor", "component", "struct", "interface", "panic"}) {
		category = "coding"
	} else if containsAny(prompt, []string{"translate", "translation", "dịch", "idiom", "grammar", "summarize", "hello", "hi ", "how are you"}) {
		category = "chat_translation"
	} else if containsAny(prompt, []string{"math", "integral", "proof", "solve", "equation", "logic", "calculate", "derivative", "theorem", "matrix"}) {
		category = "math_reasoning"
	}

	bestModelIdx := -1
	for i, m := range models {
		mLower := strings.ToLower(m)
		switch category {
		case "coding":
			if strings.Contains(mLower, "claude") || strings.Contains(mLower, "glm") || strings.Contains(mLower, "deepseek") || strings.Contains(mLower, "gpt-4o") {
				bestModelIdx = i
			}
		case "long_context":
			if strings.Contains(mLower, "gemini") {
				bestModelIdx = i
			}
		case "math_reasoning":
			if strings.Contains(mLower, "deepseek") || strings.Contains(mLower, "o1") || strings.Contains(mLower, "pro") {
				bestModelIdx = i
			}
		case "chat_translation":
			if strings.Contains(mLower, "mini") || strings.Contains(mLower, "flash") || strings.Contains(mLower, "qwen") || strings.Contains(mLower, "haiku") {
				bestModelIdx = i
			}
		}
		if bestModelIdx != -1 {
			break
		}
	}

	if bestModelIdx <= 0 {
		return models
	}

	ranked := append([]string{models[bestModelIdx]}, models[:bestModelIdx]...)
	ranked = append(ranked, models[bestModelIdx+1:]...)
	return ranked
}

func containsAny(s string, keywords []string) bool {
	for _, k := range keywords {
		if strings.Contains(s, k) {
			return true
		}
	}
	return false
}

func getActiveConnectionsForPrefix(providerPrefix string) ([]db.ProviderConnection, error) {
	conns, err := db.GetActiveConnectionsForProvider(providerPrefix)
	if err == nil && len(conns) > 0 {
		return conns, nil
	}

	allConns, err := db.ListConnections()
	if err != nil {
		return nil, err
	}

	for _, c := range allConns {
		if !c.IsActive {
			continue
		}
		prefix, _ := c.Data["modelPrefix"].(string)
		prefix = strings.TrimSuffix(prefix, "/")
		if prefix == providerPrefix {
			return db.GetActiveConnectionsForProvider(c.Provider)
		}
	}

	return nil, nil
}
