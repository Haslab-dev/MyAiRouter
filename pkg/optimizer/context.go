package optimizer

import (
	"context"
	"time"
)

type CompressionProfile struct {
	Name           string  `json:"name"`
	TargetRatio    float64 `json:"targetRatio"`
	Aggressiveness float64 `json:"aggressiveness"`
}

type OptimizationContext struct {
	Context         context.Context        `json:"-"`
	Messages        []interface{}          `json:"messages"`
	OriginalModel   string                 `json:"originalModel"`
	Model           string                 `json:"model"`
	Provider        string                 `json:"provider"`
	ContentType     string                 `json:"contentType"`
	Language        string                 `json:"language"`
	HasJSON         bool                   `json:"hasJson"`
	HasCode         bool                   `json:"hasCode"`
	HasLogs         bool                   `json:"hasLogs"`
	HasMarkdown     bool                   `json:"hasMarkdown"`
	HasSecrets      bool                   `json:"hasSecrets"`
	EstimatedTokens int                    `json:"estimatedTokens"`
	Goal            string                 `json:"goal"`
	Profile         CompressionProfile     `json:"profile"`
	Metadata        map[string]interface{} `json:"metadata"`
}

func (c *OptimizationContext) Clone() *OptimizationContext {
	clonedMsgs := make([]interface{}, len(c.Messages))
	for i, m := range c.Messages {
		if msgMap, ok := m.(map[string]interface{}); ok {
			clonedMsg := make(map[string]interface{})
			for k, v := range msgMap {
				clonedMsg[k] = v
			}
			clonedMsgs[i] = clonedMsg
		} else {
			clonedMsgs[i] = m
		}
	}

	clonedMeta := make(map[string]interface{})
	for k, v := range c.Metadata {
		clonedMeta[k] = v
	}

	return &OptimizationContext{
		Context:         c.Context,
		Messages:        clonedMsgs,
		OriginalModel:   c.OriginalModel,
		Model:           c.Model,
		Provider:        c.Provider,
		ContentType:     c.ContentType,
		Language:        c.Language,
		HasJSON:         c.HasJSON,
		HasCode:         c.HasCode,
		HasLogs:         c.HasLogs,
		HasMarkdown:     c.HasMarkdown,
		HasSecrets:      c.HasSecrets,
		EstimatedTokens: c.EstimatedTokens,
		Goal:            c.Goal,
		Profile:         c.Profile,
		Metadata:        clonedMeta,
	}
}

type PassStats struct {
	PassName           string        `json:"passName"`
	TokensBefore       int           `json:"tokensBefore"`
	TokensAfter        int           `json:"tokensAfter"`
	BytesBefore        int           `json:"bytesBefore"`
	BytesAfter         int           `json:"bytesAfter"`
	CPUTime            time.Duration `json:"cpuTime"`
	EstimatedCostSaved float64       `json:"estimatedCostSaved"`
	CompressionRatio   float64       `json:"compressionRatio"`
}

type PassResult struct {
	Messages []interface{} `json:"messages"`
	Success  bool          `json:"success"`
	Rollback bool          `json:"rollback"`
	Warnings []string      `json:"warnings"`
	Action   ExplainAction `json:"action"`
}

type ExplainAction struct {
	Pass    string                 `json:"pass"`
	Action  string                 `json:"action"`
	Details map[string]interface{} `json:"details"`
}
