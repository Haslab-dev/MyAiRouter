package providers

import (
	"context"
	"io"
	"net/http"
	"time"

	"myAiRouter/pkg/db"
)

var SharedTransport = &http.Transport{
	MaxIdleConns:        1000,
	MaxIdleConnsPerHost: 100,
	IdleConnTimeout:     90 * time.Second,
}

var SharedHTTPClient = &http.Client{
	Transport: SharedTransport,
	Timeout:   120 * time.Second,
}

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
