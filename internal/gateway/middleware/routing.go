package middleware

import (
	"fmt"
	"sort"
	"strings"
	"sync/atomic"

	"myAiRouter/internal/gateway/context"
	"myAiRouter/internal/gateway/health"
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
	seenConnIDs := make(map[string]bool)

	for _, currentModel := range modelsToTry {
		cfg := db.GetModelConfigOrDefault(currentModel)
		baseModelName := currentModel
		if idx := strings.Index(currentModel, "/"); idx != -1 {
			baseModelName = currentModel[idx+1:]
		}

		// 1. Resolve Primary Provider targets
		primaryProvider := cfg.Routing.PrimaryProvider
		accounts, err := getActiveConnectionsForPrefix(primaryProvider)
		if err == nil && len(accounts) > 0 {
			targetModelName := resolveTargetModelName(primaryProvider, baseModelName)
			for _, acc := range accounts {
				if !seenConnIDs[acc.ID] {
					targets = append(targets, ConnectionModel{
						Connection: acc,
						ModelName:  targetModelName,
						Provider:   primaryProvider,
					})
					seenConnIDs[acc.ID] = true
				}
			}
		}

		// 2. Resolve Fallback Model targets
		if cfg.Routing.FallbackModel != nil && *cfg.Routing.FallbackModel != "" && *cfg.Routing.FallbackModel != "None" {
			fallbackModelID := *cfg.Routing.FallbackModel
			fbProvider := "openai"
			fbModelName := fallbackModelID
			if idx := strings.Index(fallbackModelID, "/"); idx != -1 {
				fbProvider = fallbackModelID[:idx]
				fbModelName = fallbackModelID[idx+1:]
			}

			fbAccounts, err := getActiveConnectionsForPrefix(fbProvider)
			if err == nil && len(fbAccounts) > 0 {
				targetModelName := resolveTargetModelName(fbProvider, fbModelName)
				for _, acc := range fbAccounts {
					if !seenConnIDs[acc.ID] {
						targets = append(targets, ConnectionModel{
							Connection: acc,
							ModelName:  targetModelName,
							Provider:   fbProvider,
						})
						seenConnIDs[acc.ID] = true
					}
				}
			}
		}
	}
	targets = orderTargetsByHealth(targets)
	if len(targets) == 0 {
		ctx.WriteError(503, "No active upstream connections found for requested models")
		ctx.AddStep("Routing", "failed", "No connections available")
		return nil
	}

	ctx.Metadata["routingTargets"] = targets
	ctx.AddStep("Routing", "success", fmt.Sprintf("Routed to %d target connection(s)", len(targets)))
	return next(ctx)
}

// orderTargetsByHealth applies the health tracker to the flattened target
// list: connections serving a cooldown are dropped when healthy alternatives
// exist, and accounts are ordered within each (model, provider) group by
// admin-configured priority first, then by observed EWMA latency.
func orderTargetsByHealth(targets []ConnectionModel) []ConnectionModel {
	healthy := make([]ConnectionModel, 0, len(targets))
	for _, t := range targets {
		if !health.Get().InCooldown(t.Connection.ID) {
			healthy = append(healthy, t)
		}
	}
	if len(healthy) > 0 {
		targets = healthy
	}

	// Stable re-order *within* each contiguous (model, provider) group so the
	// combo's model-level order is preserved.
	start := 0
	for start < len(targets) {
		end := start + 1
		for end < len(targets) && targets[end].Provider == targets[start].Provider && targets[end].ModelName == targets[start].ModelName {
			end++
		}
		group := targets[start:end]
		sort.SliceStable(group, func(i, j int) bool {
			pi, pj := group[i].Connection.Priority, group[j].Connection.Priority
			if pi != pj {
				return pi < pj
			}
			return health.Get().LatencyMs(group[i].Connection.ID) < health.Get().LatencyMs(group[j].Connection.ID)
		})
		start = end
	}
	return targets
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

	allConns := db.SnapshotAllConnections()

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

func resolveTargetModelName(providerAlias string, baseModelName string) string {
	customs, err := db.GetCustomModels()
	if err == nil {
		for _, cm := range customs {
			if cm.ProviderAlias == providerAlias {
				if cm.ID == baseModelName || strings.HasSuffix(cm.ID, "/"+baseModelName) || strings.HasSuffix(cm.ID, "|"+baseModelName) {
					return cm.ID
				}
			}
		}
	}
	return baseModelName
}
