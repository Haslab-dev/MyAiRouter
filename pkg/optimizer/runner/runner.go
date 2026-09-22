package runner

import (
	"fmt"
	"time"

	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/analyzers"
	"myAiRouter/pkg/optimizer/planner"
	"myAiRouter/pkg/optimizer/registry"
)

type Runner struct{}

func NewRunner() *Runner {
	return &Runner{}
}

func (r *Runner) Run(ctx *optimizer.OptimizationContext, plan *planner.ExecutionPlan) (*optimizer.OptimizationReport, error) {
	startTime := time.Now()

	origTokens := ctx.EstimatedTokens
	origBytes := analyzers.CalculateBytes(ctx.Messages)

	contextChain := []*optimizer.OptimizationContext{ctx}

	var passesApplied []string
	var passBreakdowns []optimizer.PassStats
	var explainLogs []optimizer.ExplainAction
	var warnings []string

	for _, pass := range plan.ActivePasses {
		passStartTime := time.Now()
		currentCtx := contextChain[len(contextChain)-1]

		res, err := pass.Run(currentCtx)
		passDur := time.Since(passStartTime)

		if err != nil {
			explainLogs = append(explainLogs, optimizer.ExplainAction{
				Pass:   pass.Name(),
				Action: "failed_pass_rollback",
				Details: map[string]interface{}{
					"error":   err.Error(),
					"message": fmt.Sprintf("Pass %s failed. Reverting to previous state.", pass.Name()),
				},
			})
			warnings = append(warnings, fmt.Sprintf("Pass %s execution error: %s", pass.Name(), err.Error()))
			continue
		}

		tokensAfter := analyzers.EstimateMessageListTokens(res.Messages)
		bytesAfter := analyzers.CalculateBytes(res.Messages)
		tokensBefore := currentCtx.EstimatedTokens
		bytesBefore := analyzers.CalculateBytes(currentCtx.Messages)

		stats := optimizer.PassStats{
			PassName:           pass.Name(),
			TokensBefore:       tokensBefore,
			TokensAfter:        tokensAfter,
			BytesBefore:        bytesBefore,
			BytesAfter:         bytesAfter,
			CPUTime:            passDur,
			EstimatedCostSaved: calculateSavings(tokensBefore - tokensAfter),
			CompressionRatio:   float64(tokensAfter) / float64(tokensBefore),
		}

		if stats.CompressionRatio == 0 {
			stats.CompressionRatio = 1.0
		}

		// Run validation on individual pass
		inflationVal := registry.GetValidator("inflation")
		if inflationVal != nil {
			if valErr := inflationVal.Verify(ctx, currentCtx.Messages, res.Messages); valErr != nil {
				res.Rollback = true
				res.Warnings = append(res.Warnings, valErr.Error())
			}
		}

		if res.Rollback || !res.Success {
			explainLogs = append(explainLogs, optimizer.ExplainAction{
				Pass:   pass.Name(),
				Action: "rollback",
				Details: map[string]interface{}{
					"warnings": res.Warnings,
					"message":  fmt.Sprintf("Pass %s triggered rollback. Restoring previous state.", pass.Name()),
				},
			})
			for _, w := range res.Warnings {
				warnings = append(warnings, fmt.Sprintf("Pass %s rollback reason: %s", pass.Name(), w))
			}
			continue
		}

		nextCtx := currentCtx.Clone()
		nextCtx.Messages = res.Messages
		nextCtx.EstimatedTokens = tokensAfter
		contextChain = append(contextChain, nextCtx)

		passesApplied = append(passesApplied, pass.Name())
		passBreakdowns = append(passBreakdowns, stats)
		explainLogs = append(explainLogs, res.Action)
	}

	// Dynamic validation checks from Registry
	finalCtx := contextChain[len(contextChain)-1]
	validationSuccess := true

	registeredValidators := registry.GetValidators()
	for _, validator := range registeredValidators {
		if err := validator.Verify(finalCtx, contextChain[0].Messages, finalCtx.Messages); err != nil {
			validationSuccess = false
			finalCtx = contextChain[0]
			explainLogs = append(explainLogs, optimizer.ExplainAction{
				Pass:   "validation:" + validator.Name(),
				Action: "global_rollback",
				Details: map[string]interface{}{
					"error":   err.Error(),
					"message": fmt.Sprintf("Global validator '%s' failed. Full rollback triggered.", validator.Name()),
				},
			})
			warnings = append(warnings, fmt.Sprintf("Validation failed on validator '%s': %s. Prompt reverted.", validator.Name(), err.Error()))
			break
		}
	}

	totalDuration := time.Since(startTime)
	finalTokens := finalCtx.EstimatedTokens
	finalBytes := analyzers.CalculateBytes(finalCtx.Messages)

	// Prepare final report
	return &optimizer.OptimizationReport{
		Engine:            plan.RoutedEngine,
		Messages:          finalCtx.Messages,
		Planner:           plan.PlannerLogs,
		Duration:          totalDuration,
		OriginalTokens:    origTokens,
		OptimizedTokens:   finalTokens,
		OriginalBytes:     origBytes,
		OptimizedBytes:    finalBytes,
		SavedTokens:       origTokens - finalTokens,
		SavedCost:         calculateSavings(origTokens - finalTokens),
		Passes:            passesApplied,
		Warnings:          warnings,
		ValidationSuccess: validationSuccess,
		ExplainLog:        explainLogs,
		PassBreakdown:     passBreakdowns,
	}, nil
}

func calculateSavings(savedTokens int) float64 {
	if savedTokens <= 0 {
		return 0.0
	}
	return float64(savedTokens) * 0.000003
}
