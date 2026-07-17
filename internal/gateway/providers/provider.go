package providers

import (
	"context"
	"io"

	"myAiRouter/pkg/db"
)

type ExecutionResult struct {
	ResponseCode int
	Body         []byte
	Stream       io.ReadCloser
	IsStream     bool
	Err          error
}

type Provider interface {
	Name() string
	Execute(ctx context.Context, conn *db.ProviderConnection, body map[string]interface{}) *ExecutionResult
}

var Registry = make(map[string]Provider)

func Register(p Provider) {
	Registry[p.Name()] = p
}

func Get(name string) Provider {
	return Registry[name]
}
