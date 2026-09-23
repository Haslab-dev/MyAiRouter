package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gwContext "myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
)

// TestPipelineThreadsChildContext is a regression test for the bug that made
// the whole gateway die with "fatal error: concurrent map writes".
//
// Retry calls next() with a fresh child context per combo target. Pipeline.Run
// used to ignore that argument and keep using the context it was created with,
// so every concurrent branch wrote to the SAME ctx.Metadata map. A middleware
// that honours the context it is handed (as Prepare does) then hit concurrent
// map writes -> unrecoverable process crash, and ctx.Connection stayed nil.
//
// The assertion is therefore: whatever context the LAST middleware receives
// must be the child, not the parent.
func TestPipelineThreadsChildContext(t *testing.T) {
	pipe := NewPipeline()

	var seen *gwContext.GatewayContext
	pipe.Use(func(ctx *gwContext.GatewayContext, next HandlerFunc) error {
		// Mimic Retry: hand the chain a brand-new child context. If Run keeps
		// its captured parent, `seen` will be that parent instead of this child.
		child := ctx.CloneForTarget(ctx.Context, &db.ProviderConnection{ID: "child-conn", Provider: "child-prov"}, "child-model", "child-prov", ctx.RequestBody)
		return next(child)
	})
	pipe.Use(func(ctx *gwContext.GatewayContext, next HandlerFunc) error {
		seen = ctx
		return next(ctx)
	})

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	parent := gwContext.NewGatewayContext(rec, req)
	parent.RequestBody = map[string]interface{}{"model": "test-model"}

	if err := pipe.Run(parent); err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if seen == nil {
		t.Fatal("second middleware never ran")
	}
	if seen == parent {
		t.Fatal("Pipeline.Run ignored the context passed to next(): child context was discarded")
	}
	if seen.Model != "child-model" {
		t.Fatalf("expected child context (model %q), got model %q", "child-model", seen.Model)
	}
	if seen.Connection == nil || seen.Connection.ID != "child-conn" {
		t.Fatalf("expected child connection to survive, got %+v", seen.Connection)
	}
}

// TestParallelStrategyReturnsPromptlyWhenAllTargetsFail guards the other half of
// the same area: when every parallel target has already failed, the combo must
// answer from the failure channel instead of holding the client until a timer
// fires.
func TestParallelStrategyReturnsPromptlyWhenAllTargetsFail(t *testing.T) {
	ctx := newRetryTestContext("parallel")
	targets := makeTargets("a-1", "b-1")
	for i := range targets {
		targets[i].Connection.ID = "fail-" + targets[i].Connection.ID
	}
	upstream := &fakeUpstream{codes: map[string]int{}}
	for _, tgt := range targets {
		upstream.codes[tgt.Connection.ID] = http.StatusInternalServerError
	}

	// Same `next` the pipeline runs: straight to the provider attempt.
	err := executeParallelStrategy(ctx, targets, upstream.next)
	if err != nil {
		t.Fatalf("executeParallelStrategy returned error: %v", err)
	}

	body := ctx.ResponseBody
	if len(body) == 0 && ctx.ResponseCode < 400 {
		t.Fatalf("expected an error response, got code=%d with empty body", ctx.ResponseCode)
	}
	var names []string
	for _, s := range ctx.Steps {
		names = append(names, s.Name)
	}
	steps := strings.Join(names, ",")
	if !strings.Contains(steps, "Parallel Execution") {
		t.Fatalf("expected a Parallel Execution step, got steps=%s", steps)
	}
	if ctx.ResponseCode == http.StatusGatewayTimeout {
		t.Fatalf("all-failed parallel combo reported a 30s timeout instead of the upstream error (code=%d)", ctx.ResponseCode)
	}
}
