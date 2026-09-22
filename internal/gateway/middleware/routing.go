package middleware

import (
	"fmt"
	"sort"
	"strings"
	"sync/atomic"

	"myAiRouter/internal/gateway/context"
	"myAiRouter/internal/gateway/health"
	"myAiRouter/pkg/db"
	pkgGateway "myAiRouter/pkg/gateway"
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

	targets := resolveConnectionTargets(modelsToTry)
	if len(targets) == 0 {
		ctx.WriteError(503, "No active upstream connections found for requested models")
		ctx.AddStep("Routing", "failed", "No connections available")
		return nil
	}

	ctx.Metadata["routingTargets"] = targets
	pkgGateway.SetTargets(ctx.LiveID, len(targets))
	ctx.AddStep("Routing", "success", fmt.Sprintf("Routed to %d target connection(s)", len(targets)))
	return next(ctx)
}

// resolveConnectionTargets is the shared target-resolution core: for each
// requested model it finds the active connections of the model's primary
// provider (and configured fallback), deduplicates and health-orders them.
// Routing uses it per request; the passthrough endpoints (/v1/embeddings,
// /v1/audio/*) use it to pick a single upstream connection.
func resolveConnectionTargets(modelsToTry []string) []ConnectionModel {
	var targets []ConnectionModel
	// Dedupe by connection+model+provider (NOT connection alone): a combo
	// like ["prov/model-A", "prov/model-B"] served by the SAME account must
	// still produce two targets so fallback can switch models.
	seen := make(map[string]bool)

	for _, currentModel := range modelsToTry {
		cfg := db.GetModelConfigOrDefault(currentModel)
		baseModelName := currentModel
		if idx := strings.Index(currentModel, "/"); idx != -1 {
			baseModelName = currentModel[idx+1:]
		}

		// 1. Resolve Primary Provider targets
		primaryProvider := cfg.Routing.PrimaryProvider
		accounts, err := getActiveConnectionsForPrefix(primaryProvider)
		if err != nil || len(accounts) == 0 {
			// Emitting a target with a zero-value Connection used to crash the
			// whole gateway later (providers.Execute nil deref). Say exactly
			// which model had no usable account instead of routing it anyway.
			fmt.Printf("myairouter: routing: model %q (provider %q) has no active upstream connection; skipping\n", currentModel, primaryProvider)
			continue
		}
		targetModelName := resolveTargetModelName(primaryProvider, baseModelName)
		for _, acc := range accounts {
			key := acc.ID + "|" + primaryProvider + "/" + targetModelName
			if !seen[key] {
				targets = append(targets, ConnectionModel{
					Connection: acc,
					ModelName:  targetModelName,
					Provider:   primaryProvider,
				})
				seen[key] = true
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
					key := acc.ID + "|" + fbProvider + "/" + targetModelName
					if !seen[key] {
						targets = append(targets, ConnectionModel{
							Connection: acc,
							ModelName:  targetModelName,
							Provider:   fbProvider,
						})
						seen[key] = true
					}
				}
			}
		}
	}
	targets = orderTargetsByHealth(targets)
	return targets
}

// ResolveConnectionTargets exposes target resolution to the passthrough
// endpoints (/v1/embeddings, /v1/audio/*) which live in another package but
// need the same health-ordered connection selection as the chat pipeline.
func ResolveConnectionTargets(modelsToTry []string) []ConnectionModel {
	return resolveConnectionTargets(modelsToTry)
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
