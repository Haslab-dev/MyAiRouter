package middleware

import (
	"fmt"
	"strings"

	"myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
)

type ConnectionModel struct {
	Connection db.ProviderConnection
	ModelName  string
	Provider   string
}

func Routing(ctx *context.GatewayContext, next HandlerFunc) error {
	modelsToTry, _ := ctx.Metadata["modelsToTry"].([]string)
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
