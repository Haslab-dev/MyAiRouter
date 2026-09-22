package middleware

import (
	"context"
	"fmt"
	"strings"

	gwContext "myAiRouter/internal/gateway/context"
	"myAiRouter/internal/gateway/providers"
	"myAiRouter/pkg/db"
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/analyzers"
	"myAiRouter/pkg/optimizer/planner"
	"myAiRouter/pkg/optimizer/registry"
	"myAiRouter/pkg/optimizer/runner"
	"myAiRouter/pkg/rtk"
)

type PrepareResult struct {
	Modified              bool   `json:"modified"`
	CompressionApplied    bool   `json:"compressionApplied"`
	OriginalTokens        int    `json:"originalTokens"`
	PreparedTokens        int    `json:"preparedTokens"`
	CompressedTokens      int    `json:"compressedTokens"`
	ProtectedPrefixTokens int    `json:"protectedPrefixTokens"`
	ProtectedSuffixTokens int    `json:"protectedSuffixTokens"`
	Strategy              string `json:"strategy"`
}

type RequestPreparer struct{}

func (p *RequestPreparer) Prepare(
	ctx context.Context,
	req map[string]interface{},
	modelCfg *db.ModelConfig,
	provider providers.Provider,
	conn *db.ProviderConnection,
) (map[string]interface{}, PrepareResult, error) {
	result := PrepareResult{
		Modified:           false,
		CompressionApplied: false,
		Strategy:           modelCfg.Compression.Strategy,
	}

	// Pass-through fast path: without an explicit per-model compression policy
	// the request is forwarded untouched — no settings lookup, no token estimation.
	if !modelCfg.Compression.Enabled {
		return req, result, nil
	}

	settings, err := db.GetSettings()
	if err != nil {
		return req, result, err
	}

	// 1. Determine if Caveman/Ponytail prompts need to be injected
	hasRewrite := false
	if modelCfg.Compression.Enabled && settings != nil && (settings.CavemanEnabled || settings.PonytailEnabled) {
		hasRewrite = true
	}

	// 2. Estimate input tokens to check if compression is needed
	originalTokens := EstimateRequestTokens(req)
	result.OriginalTokens = originalTokens
	result.PreparedTokens = originalTokens

	// 3. Determine if compression needs to be applied
	hasCompression := false
	if modelCfg.Compression.Enabled {
		if modelCfg.Compression.Trigger == "context_limit" {
			contextLimit := 128000
			switch provider.Name() {
			case "anthropic":
				contextLimit = 200000
			case "gemini":
				contextLimit = 1000000
			case "openai":
				contextLimit = 128000
			}
			if originalTokens > contextLimit {
				hasCompression = true
			}
		} else {
			if originalTokens > modelCfg.Compression.ThresholdTokens {
				hasCompression = true
			}
		}
	}

	// If no modification is needed, return the original request unchanged
	if !hasRewrite && !hasCompression {
		return req, result, nil
	}

	result.Modified = true

	// Clone the request body to avoid mutating the original
	prepared := cloneMap(req)

	// A. Apply rewrite if enabled
	if hasRewrite {
		format := provider.Name()
		if format != "anthropic" && format != "gemini" {
			format = "openai"
		}
		rtk.InjectSystemPrompts(prepared, format, settings)
	}

	// B. Apply dynamic compression if enabled and threshold exceeded
	if hasCompression {
		msgs, ok := prepared["messages"].([]interface{})
		if ok && len(msgs) > 0 {
			// Find system messages at the start to preserve them as protected prefix
			var systemMsgs []interface{}
			startIndex := 0
			for i := range msgs {
				if mMap, ok := msgs[i].(map[string]interface{}); ok {
					if role, _ := mMap["role"].(string); role == "system" {
						systemMsgs = append(systemMsgs, msgs[i])
						startIndex = i + 1
					} else {
						break
					}
				} else {
					break
				}
			}

			// Estimate prefix tokens
			result.ProtectedPrefixTokens = analyzers.EstimateMessageListTokens(systemMsgs)

			// Determine messages to preserve at the end (recent context / protected suffix)
			preserveCount := modelCfg.Compression.PreserveRecentMessages
			if preserveCount <= 0 {
				preserveCount = 20
			}

			convCount := len(msgs) - startIndex
			if convCount > preserveCount {
				recentIndex := len(msgs) - preserveCount
				recentMsgs := msgs[recentIndex:]
				olderMsgs := msgs[startIndex:recentIndex]

				// Estimate suffix tokens
				result.ProtectedSuffixTokens = analyzers.EstimateMessageListTokens(recentMsgs)
				var compressedOlderMsgs []interface{}
				if settings.OptimizerEnabled {
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
						Context:       ctx,
						Messages:      olderMsgs,
						OriginalModel: modelCfg.ID,
						Model:         modelCfg.ID,
						Provider:      provider.Name(),
						Goal:          settings.OptimizationGoal,
						Profile: optimizer.CompressionProfile{
							Name:           settings.OptimizationProfile,
							TargetRatio:    ratio,
							Aggressiveness: aggr,
						},
						Metadata: make(map[string]interface{}),
					}

					// Run analyzers
					loadedAnalyzers := registry.GetAnalyzers()
					for _, a := range loadedAnalyzers {
						_ = a.Analyze(optCtx)
					}

					// Plan execution
					plannerObj := planner.NewPlanner()
					plan, planErr := plannerObj.Plan(optCtx, settings.OptimizationEngine, settings.PipelineSteps)
					if planErr == nil {
						runnerObj := runner.NewRunner()
						res, runErr := runnerObj.Run(optCtx, plan)
						if runErr == nil {
							compressedOlderMsgs = res.Messages
							result.CompressionApplied = true
						}
					}
				}

				// If optimizer wasn't run or failed, fallback to legacy RTK/Headroom
				if !result.CompressionApplied {
					tempBody := map[string]interface{}{"messages": olderMsgs}
					rtk.CompressMessages(tempBody, settings.RtkEnabled)

					olderCompressed := tempBody["messages"].([]interface{})
					if settings.HeadroomEnabled && settings.HeadroomUrl != "" {
						olderCompressed = rtk.CompressWithHeadroom(ctx, settings.HeadroomUrl, modelCfg.ID, olderCompressed)
					}
					compressedOlderMsgs = olderCompressed
					result.CompressionApplied = true
				}

				// Reconstruct messages
				newMsgs := append([]interface{}{}, systemMsgs...)
				newMsgs = append(newMsgs, compressedOlderMsgs...)
				newMsgs = append(newMsgs, recentMsgs...)
				prepared["messages"] = newMsgs
			}
		}
	}

	result.PreparedTokens = EstimateRequestTokens(prepared)
	if result.CompressionApplied {
		result.CompressedTokens = result.OriginalTokens - result.PreparedTokens
		if result.CompressedTokens < 0 {
			result.CompressedTokens = 0
		}
	}
	return prepared, result, nil
}

func EstimateRequestTokens(body map[string]interface{}) int {
	if msgs, ok := body["messages"].([]interface{}); ok {
		return analyzers.EstimateMessageListTokens(msgs)
	}
	if prompt, ok := body["prompt"].(string); ok {
		return analyzers.EstimateTokens(prompt)
	}
	return 0
}

func Prepare(ctx *gwContext.GatewayContext, next HandlerFunc) error {
	ctx.AddStep("Request Preparation", "started", "Executing request preparation & dynamic compression")

	modelCfg := db.GetModelConfigOrDefault(ctx.Model)

	// X-No-Compress: per-request opt-out guarantees a byte-identical pass-through.
	if ctx.Request != nil && strings.EqualFold(ctx.Request.Header.Get("X-No-Compress"), "true") {
		modelCfg.Compression.Enabled = false
	}

	p := providers.Get(ctx.Provider)
	if p == nil {
		p = providers.Get("openai")
	}

	preparer := &RequestPreparer{}
	preparedBody, res, err := preparer.Prepare(ctx.Context, ctx.RequestBody, modelCfg, p, ctx.Connection)
	if err != nil {
		ctx.AddStep("Request Preparation", "failed", fmt.Sprintf("Preparation failed: %s", err.Error()))
		return next(ctx)
	}

	// For streaming requests, request usage in stream if not explicitly set
	if ctx.IsStream {
		if stream, ok := preparedBody["stream"].(bool); stream && ok {
			if _, hasOpts := preparedBody["stream_options"]; !hasOpts {
				preparedBody["stream_options"] = map[string]interface{}{"include_usage": true}
			}
		}
	}

	// Update context with prepared body and execution details
	ctx.RequestBody = preparedBody
	if res.PreparedTokens > 0 {
		ctx.PromptTokens = res.PreparedTokens
	}
	ctx.Metadata["prepareResult"] = res

	if res.CompressionApplied {
		reduction := 0
		if res.OriginalTokens > 0 {
			reduction = int((float64(res.OriginalTokens-res.PreparedTokens) / float64(res.OriginalTokens)) * 100)
		}
		ctx.Metadata["compressionPct"] = reduction
		ctx.AddStep("Request Preparation", "success", fmt.Sprintf("Dynamic compression applied: saved %d%% tokens (%d -> %d)", reduction, res.OriginalTokens, res.PreparedTokens))
	} else {
		ctx.AddStep("Request Preparation", "success", "No transformation required")
	}

	return next(ctx)
}
