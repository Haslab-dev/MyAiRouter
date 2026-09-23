package middleware

import (
	"net/http"
	"os"
	"testing"

	gwContext "myAiRouter/internal/gateway/context"
	"myAiRouter/pkg/db"
)

func passThrough(ctx *gwContext.GatewayContext) error {
	ctx.ResponseCode = 200
	return nil
}

func newScopeTestContext(model string) *gwContext.GatewayContext {
	ctx := newRetryTestContext("fallback")
	ctx.RequestBody = map[string]interface{}{
		"model":    model,
		"messages": []interface{}{map[string]interface{}{"role": "user", "content": "hi"}},
	}
	return ctx
}

// TestAuthApiKeyScope enforces the per-key allowlist: a scoped key calling an
// out-of-scope model gets 403 before any upstream is touched.
func TestAuthApiKeyScope(t *testing.T) {
	tmp, err := os.MkdirTemp("", "jr_scope_mw_*")
	if err != nil {
		t.Fatalf("temp: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(tmp) })
	t.Setenv("HOME", tmp)
	t.Setenv("USERPROFILE", tmp)
	if err := db.InitDB(); err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	if err := db.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	if _, err := db.UpdateSettings(map[string]interface{}{"requireLogin": true}); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}

	key, err := db.CreateApiKey("scope-test")
	if err != nil {
		t.Fatalf("CreateApiKey: %v", err)
	}
	if err := db.UpdateApiKeyScope(key.ID, db.ApiKeyScope{
		AllowedModels: []string{"Collabs"},
	}); err != nil {
		t.Fatalf("UpdateApiKeyScope: %v", err)
	}

	// In-scope model passes.
	ctx := newScopeTestContext("Collabs")
	ctx.Request.Header.Set("Authorization", "Bearer "+key.Key)
	if err := Auth(ctx, passThrough); err != nil {
		t.Fatalf("allowed model: %v", err)
	}
	if ctx.ResponseCode != 200 {
		t.Fatalf("allowed model: code = %d, want 200", ctx.ResponseCode)
	}

	// Out-of-scope model is rejected with 403.
	ctx = newScopeTestContext("deepseek/deepseek-chat")
	ctx.Request.Header.Set("Authorization", "Bearer "+key.Key)
	if err := Auth(ctx, passThrough); err != nil {
		t.Fatalf("denied model: %v", err)
	}
	if ctx.ResponseCode != http.StatusForbidden {
		t.Fatalf("denied model: code = %d, want 403", ctx.ResponseCode)
	}
}
