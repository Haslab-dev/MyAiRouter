package middleware

import (
	"net/http/httptest"
	"strings"
	"testing"

	gwContext "myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
)

type fakeUpstream struct {
	// connectionID -> status code to return (0 = success)
	codes map[string]int
}

func (f *fakeUpstream) next(ctx *gwContext.GatewayContext) error {
	id := ctx.Connection.ID
	if code, ok := f.codes[id]; ok {
		ctx.ResponseCode = code
		ctx.ResponseBody = []byte(`{"error":{"message":"upstream says no"}}`)
		return nil
	}
	ctx.ResponseCode = 200
	ctx.ResponseBody = []byte(`{"choices":[{"message":{"content":"ok"}}]}`)
	return nil
}

func newRetryTestContext(comboKind string) *gwContext.GatewayContext {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	ctx := gwContext.NewGatewayContext(rec, req)
	ctx.RequestID = "retry-test"
	ctx.RequestBody = map[string]interface{}{
		"model":    "test-model",
		"messages": []interface{}{map[string]interface{}{"role": "user", "content": "hi"}},
	}
	ctx.Metadata["comboKind"] = comboKind
	return ctx
}

func makeTargets(ids ...string) []ConnectionModel {
	targets := make([]ConnectionModel, 0, len(ids))
	for _, id := range ids {
		// Provider is the prefix before the first dash. Accounts of the same
		// provider serve the SAME model (that is how routing.go builds combo
		// targets), so the model name is derived from the provider, not the
		// connection id.
		provider := "prov-" + strings.SplitN(id, "-", 2)[0]
		targets = append(targets, ConnectionModel{
			Connection: db.ProviderConnection{ID: id, Provider: provider, Priority: 1, IsActive: true},
			ModelName:  "model-" + provider,
			Provider:   provider,
		})
	}
	return targets
}

// makeModelTargets builds targets where each entry is a DISTINCT combo model
// (different provider AND model), for cross-model failover tests.
func makeModelTargets(provider, model string, connIDs ...string) []ConnectionModel {
	targets := make([]ConnectionModel, 0, len(connIDs))
	for _, id := range connIDs {
		targets = append(targets, ConnectionModel{
			Connection: db.ProviderConnection{ID: id, Provider: provider, Priority: 1, IsActive: true},
			ModelName:  model,
			Provider:   provider,
		})
	}
	return targets
}

func TestRetry_Matrix(t *testing.T) {
	t.Run("5xx falls back through every target", func(t *testing.T) {
		ctx := newRetryTestContext("fallback")
		ctx.Metadata["routingTargets"] = makeTargets("a1-conn", "b1-conn", "c1-conn")
		up := &fakeUpstream{codes: map[string]int{"a1-conn": 500, "b1-conn": 503}}

		err := Retry(ctx, up.next)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ctx.FallbackCount != 2 {
			t.Fatalf("FallbackCount = %d, want 2", ctx.FallbackCount)
		}
		if len(ctx.TargetAttempts) != 3 {
			t.Fatalf("attempts = %d, want 3", len(ctx.TargetAttempts))
		}
		last := ctx.TargetAttempts[2]
		if last.Status != "success" {
			t.Fatalf("last attempt status = %s, want success", last.Status)
		}
	})

	t.Run("400 is terminal and passes the upstream error through", func(t *testing.T) {
		ctx := newRetryTestContext("fallback")
		ctx.Metadata["routingTargets"] = makeTargets("t1-conn", "t2-conn")
		up := &fakeUpstream{codes: map[string]int{"t1-conn": 400}}

		err := Retry(ctx, up.next)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(ctx.TargetAttempts) != 1 {
			t.Fatalf("attempts = %d, want exactly 1 (no fallback on 400)", len(ctx.TargetAttempts))
		}
		if ctx.ResponseCode != 400 {
			t.Fatalf("status = %d, want 400", ctx.ResponseCode)
		}
		if !strings.Contains(string(ctx.ResponseBody), "upstream says no") {
			t.Fatalf("upstream error body not passed through: %s", ctx.ResponseBody)
		}
	})

	t.Run("429 falls back to the next target", func(t *testing.T) {
		ctx := newRetryTestContext("fallback")
		ctx.Metadata["routingTargets"] = makeTargets("r1-conn", "r2-conn")
		up := &fakeUpstream{codes: map[string]int{"r1-conn": 429}}

		err := Retry(ctx, up.next)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(ctx.TargetAttempts) != 2 {
			t.Fatalf("attempts = %d, want 2", len(ctx.TargetAttempts))
		}
		if ctx.TargetAttempts[1].Status != "success" {
			t.Fatalf("second attempt should succeed")
		}
	})

	t.Run("401 stops after exhausting same-provider accounts", func(t *testing.T) {
		ctx := newRetryTestContext("fallback")
		// Two accounts of model A on provider p1, then a DIFFERENT account of
		// the SAME model on provider p2 — auth errors must not cross models.
		targets := append(makeModelTargets("p1", "model-a", "p1-a", "p1-b"), makeModelTargets("p2", "model-a", "p2-a")...)
		ctx.Metadata["routingTargets"] = targets
		up := &fakeUpstream{codes: map[string]int{"p1-a": 401, "p1-b": 401}}

		err := Retry(ctx, up.next)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(ctx.TargetAttempts) != 2 {
			t.Fatalf("attempts = %d, want 2 (must not cross to another provider's model on auth errors)", len(ctx.TargetAttempts))
		}
		if ctx.ResponseCode != 401 {
			t.Fatalf("status = %d, want 401", ctx.ResponseCode)
		}
	})

	t.Run("401 falls through to a different combo model (round-robin)", func(t *testing.T) {
		ctx := newRetryTestContext("fallback")
		// Combo listed model-a (provider p1) then model-b (provider p2).
		// p1 returns 401 → engine must advance to model-b instead of dying.
		targets := append(makeModelTargets("p1", "model-a", "p1-a"), makeModelTargets("p2", "model-b", "p2-a")...)
		ctx.Metadata["routingTargets"] = targets
		up := &fakeUpstream{codes: map[string]int{"p1-a": 401}}

		err := Retry(ctx, up.next)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(ctx.TargetAttempts) != 2 {
			t.Fatalf("attempts = %d, want 2 (cross-provider combo model must be tried on 401)", len(ctx.TargetAttempts))
		}
		if ctx.TargetAttempts[1].Status != "success" {
			t.Fatalf("second attempt (other provider's model) should succeed")
		}
	})

	t.Run("fallback budget caps hops", func(t *testing.T) {
		ctx := newRetryTestContext("fallback")
		ctx.Metadata["routingTargets"] = makeTargets("m1-conn", "m2-conn", "m3-conn")
		ctx.Metadata["attemptPolicy"] = &db.AttemptPolicy{MaxFallbacks: 1}
		up := &fakeUpstream{codes: map[string]int{"m1-conn": 500, "m2-conn": 500, "m3-conn": 500}}

		err := Retry(ctx, up.next)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(ctx.TargetAttempts) != 2 {
			t.Fatalf("attempts = %d, want 2 (budget of 1 fallback allows 2 attempts)", len(ctx.TargetAttempts))
		}
	})

	t.Run("aggressive policy falls back even on 400", func(t *testing.T) {
		ctx := newRetryTestContext("fallback")
		ctx.Metadata["routingTargets"] = makeTargets("g1-conn", "g2-conn")
		ctx.Metadata["attemptPolicy"] = &db.AttemptPolicy{FallbackPolicy: "aggressive"}
		up := &fakeUpstream{codes: map[string]int{"g1-conn": 400}}

		err := Retry(ctx, up.next)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(ctx.TargetAttempts) != 2 {
			t.Fatalf("attempts = %d, want 2 (aggressive falls back on any error)", len(ctx.TargetAttempts))
		}
	})

	t.Run("streaming requests bypass concurrent strategies", func(t *testing.T) {
		ctx := newRetryTestContext("race")
		ctx.IsStream = true
		ctx.Metadata["routingTargets"] = makeTargets("st1-conn", "st2-conn")
		up := &fakeUpstream{}

		err := Retry(ctx, up.next)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		// Sequential semantics: first target wins, the second is skipped —
		// never a concurrent fan-out with per-target results.
		if len(ctx.TargetAttempts) != 2 {
			t.Fatalf("attempts = %d, want 2 (1 success + 1 skipped)", len(ctx.TargetAttempts))
		}
		if ctx.TargetAttempts[0].Status != "success" || ctx.TargetAttempts[1].Status != "skipped" {
			t.Fatalf("statuses = %s/%s, want success/skipped", ctx.TargetAttempts[0].Status, ctx.TargetAttempts[1].Status)
		}
	})
}
