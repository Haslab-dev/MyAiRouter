package optimizer

type Reference struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	Description string `json:"description"`
}

type EngineMetadata struct {
	ID             string       `json:"id"`
	Name           string       `json:"name"`
	Description    string       `json:"description"`
	EstimatedSpeed string       `json:"estimatedSpeed"`
	Capabilities   Capabilities `json:"capabilities"`
	DefaultPasses  []string     `json:"defaultPasses"`
	References     []Reference  `json:"references"`
}

type Capabilities struct {
	SupportsJson bool `json:"supportsJson"`
	SupportsCode bool `json:"supportsCode"`
	SupportsLogs bool `json:"supportsLogs"`
}

type ProviderProfile struct {
	Name            string `json:"name"`
	MaxInputTokens  int    `json:"maxInputTokens"`
	SupportsSystem  bool   `json:"supportsSystem"`
	SystemSafeLimit int    `json:"systemSafeLimit"`
}

type Pass interface {
	Name() string
	Version() string
	Category() string
	Description() string
	CanRun(ctx *OptimizationContext) bool
	Requires() []string
	Before() []string
	After() []string
	Run(ctx *OptimizationContext) (PassResult, error)
}

type Validator interface {
	Name() string
	Verify(ctx *OptimizationContext, beforeMessages, afterMessages []interface{}) error
}

type Analyzer interface {
	Analyze(ctx *OptimizationContext) error
}
