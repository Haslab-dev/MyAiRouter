package middleware

import (
	"fmt"
	"myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/planner"
	"myAiRouter/pkg/optimizer/registry"
	"myAiRouter/pkg/optimizer/runner"
	_ "myAiRouter/pkg/optimizer/passes"
	_ "myAiRouter/pkg/optimizer/profiles"
	_ "myAiRouter/pkg/optimizer/validators"
	"myAiRouter/pkg/rtk"
)

func Compression(ctx *context.GatewayContext, next HandlerFunc) error {
	settings, err := db.GetSettings()
	if err == nil && settings != nil {
		if settings.OptimizerEnabled {
			if msgs, ok := ctx.RequestBody["messages"].([]interface{}); ok {
				ctx.AddStep("Prompt Optimizer", "started", fmt.Sprintf("Running prompt optimizer pipeline (Engine: %s, Goal: %s, Profile: %s)", settings.OptimizationEngine, settings.OptimizationGoal, settings.OptimizationProfile))
				
				// 1. Create optimization context
				ratio := 0.60
				aggr := 0.5
				switch settings.OptimizationProfile {
				case "lite":
					ratio = 0.85
					aggr = 0.3
				case "balanced":
					ratio = 0.60
					aggr = 0.5
				case "aggressive":
					ratio = 0.40
					aggr = 0.7
				case "extreme":
					ratio = 0.20
					aggr = 0.9
				}

				optCtx := &optimizer.OptimizationContext{
					Context:          ctx.Context,
					Messages:         msgs,
					OriginalModel:    ctx.OriginalModel,
					Model:            ctx.Model,
					Provider:         ctx.Provider,
					Goal:             settings.OptimizationGoal,
					Profile:          optimizer.CompressionProfile{
						Name:           settings.OptimizationProfile,
						TargetRatio:    ratio,
						Aggressiveness: aggr,
					},
					Metadata:         make(map[string]interface{}),
				}

				// 2. Run analyzers
				loadedAnalyzers := registry.GetAnalyzers()
				for _, a := range loadedAnalyzers {
					_ = a.Analyze(optCtx)
				}

				// 3. Plan execution
				plannerObj := planner.NewPlanner()
				plan, planErr := plannerObj.Plan(optCtx, settings.OptimizationEngine, settings.PipelineSteps)
				if planErr == nil {
					// 4. Run pipeline
					runnerObj := runner.NewRunner()
					res, runErr := runnerObj.Run(optCtx, plan)
					if runErr == nil {
						ctx.RequestBody["messages"] = res.Messages
						savedPct := 0
						if res.OriginalTokens > 0 {
							savedPct = int((float64(res.SavedTokens) / float64(res.OriginalTokens)) * 100)
						}
						ctx.AddStep("Prompt Optimizer", "success", fmt.Sprintf("Optimization completed: saved %d%% tokens (%d -> %d) using %s plan.", savedPct, res.OriginalTokens, res.OptimizedTokens, plan.RoutedEngine))
					} else {
						ctx.AddStep("Prompt Optimizer", "failed", fmt.Sprintf("Runner failed: %s. Reverting to original.", runErr.Error()))
					}
				} else {
					ctx.AddStep("Prompt Optimizer", "failed", fmt.Sprintf("Planner failed: %s", planErr.Error()))
				}
			}
		} else {
			// Legacy compression fallback
			ctx.AddStep("Compression", "started", "Running legacy token compression (RTK Bolt & Headroom)")
			rtk.CompressMessages(ctx.RequestBody, settings.RtkEnabled)

			if settings.HeadroomEnabled && settings.HeadroomUrl != "" {
				if msgs, ok := ctx.RequestBody["messages"].([]interface{}); ok {
					compressed := rtk.CompressWithHeadroom(ctx.Context, settings.HeadroomUrl, ctx.Model, msgs)
					ctx.RequestBody["messages"] = compressed
					ctx.AddStep("Compression", "success", "RTK Bolt & Headroom compression executed")
				}
			} else {
				ctx.AddStep("Compression", "success", "RTK Bolt compression executed")
			}
		}
	} else {
		ctx.AddStep("Compression", "skipped", "Compression settings not found")
	}

	return next(ctx)
}
