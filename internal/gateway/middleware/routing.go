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

func extractMessageText(content interface{}) string {
	switch v := content.(type) {
	case string:
		return v
	case []interface{}:
		var b strings.Builder
		for _, part := range v {
			if pm, ok := part.(map[string]interface{}); ok {
				if t, ok := pm["text"].(string); ok && t != "" {
					b.WriteString(t)
					b.WriteByte(' ')
				}
			}
		}
		return b.String()
	default:
		return ""
	}
}

func classifyAndRankModels(body map[string]interface{}, models []string) []string {
	var promptBuilder strings.Builder
	if msgs, ok := body["messages"].([]interface{}); ok {
		for _, item := range msgs {
			if m, ok := item.(map[string]interface{}); ok {
				if txt := extractMessageText(m["content"]); txt != "" {
					promptBuilder.WriteString(txt)
					promptBuilder.WriteByte(' ')
				}
			}
		}
	}
	prompt := strings.ToLower(promptBuilder.String())
	charCount := len(prompt)

	hasTools := false
	if tools, ok := body["tools"].([]interface{}); ok && len(tools) > 0 {
		hasTools = true
	} else if fns, ok := body["functions"].([]interface{}); ok && len(fns) > 0 {
		hasTools = true
	}

	category := "general"
	if charCount > 8000 {
		category = "long_context"
	} else if hasTools || containsAny(prompt, []string{"code", "function", "def ", "class ", "import ", "err !=", "html", "css", "script", "json", "sql", "bug", "fix", "refactor", "component", "struct", "interface", "panic"}) {
		category = "coding"
	} else if containsAny(prompt, []string{"math", "integral", "proof", "solve", "equation", "logic", "calculate", "derivative", "theorem", "matrix"}) {
		category = "math_reasoning"
	} else if containsAny(prompt, []string{"translate", "translation", "dịch", "idiom", "grammar", "summarize", "hello", "hi ", "how are you"}) {
		category = "chat_translation"
	}

	scoreModel := func(m string) int {
		mLower := strings.ToLower(m)
		score := 0
		switch category {
		case "coding":
			if containsAny(mLower, []string{"claude", "sonnet", "opus", "coder", "codestral", "deepseek", "glm", "qwen", "qwopus", "gpt-4o"}) {
				score += 10
			}
			if containsAny(mLower, []string{"coder", "deepseek", "claude", "glm-5", "glm-4.7"}) {
				score += 3
			}
		case "long_context":
			if containsAny(mLower, []string{"gemini", "claude", "qwen", "deepseek", "glm"}) {
				score += 10
			}
			if containsAny(mLower, []string{"gemini", "1m", "128k"}) {
				score += 3
			}
		case "math_reasoning":
			if containsAny(mLower, []string{"reasoner", "r1", "thinking", "qwopus", "qwq", "o1", "o3", "o4", "deepseek", "glm-5", "pro"}) {
				score += 10
			}
		case "chat_translation":
			if containsAny(mLower, []string{"flash", "mini", "nano", "lite", "haiku", "turbo", "qwen", "glm-4.5"}) {
				score += 10
			}
		}
		if hasTools && containsAny(mLower, []string{"claude", "gpt-4", "deepseek", "glm", "qwen", "gemini"}) {
			score += 2
		}
		return score
	}

	ranked := append([]string{}, models...)
	sort.SliceStable(ranked, func(i, j int) bool {
		return scoreModel(ranked[i]) > scoreModel(ranked[j])
	})
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
