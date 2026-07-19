package optimizer

import (
	"time"
)

type OptimizationReport struct {
	Engine            string          `json:"engine"`
	Messages          []interface{}   `json:"messages"` // Optimized messages
	Planner           []string        `json:"planner"`
	Duration          time.Duration   `json:"duration"`
	OriginalTokens    int             `json:"originalTokens"`
	OptimizedTokens   int             `json:"optimizedTokens"`
	OriginalBytes     int             `json:"originalBytes"`
	OptimizedBytes    int             `json:"optimizedBytes"`
	SavedTokens       int             `json:"savedTokens"`
	SavedCost         float64         `json:"savedCost"`
	Passes            []string        `json:"passes"`
	Warnings          []string        `json:"warnings"`
	ValidationSuccess bool            `json:"validationSuccess"`
	ExplainLog        []ExplainAction `json:"explainLog"`
	PassBreakdown     []PassStats     `json:"passBreakdown"`
}
