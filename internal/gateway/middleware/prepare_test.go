package middleware

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	gwContext "myAiRouter/internal/gateway/context"
	"myAiRouter/internal/gateway/providers"
	"myAiRouter/pkg/db"
)

func TestRequestPreparer(t *testing.T) {
	// Initialize temporary database for settings lookup
	tmpDir, err := os.MkdirTemp("", "airouter_test_prepare_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)
	t.Setenv("HOME", tmpDir)

	if err := db.InitDB(); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}

	// 1. Test case: No rewrite, no compression. Request should be returned verbatim.
	req := map[string]interface{}{
		"model": "openai/gpt-4o",
		"messages": []interface{}{
			map[string]interface{}{"role": "user", "content": "hello"},
		},
	}

	modelCfg := &db.ModelConfig{
		ID:   "openai/gpt-4o",
		Name: "gpt-4o",
		Routing: db.RoutingConfig{
			PrimaryProvider: "openai",
		},
		Compression: db.CompressionConfig{
			Enabled:                false,
			ThresholdTokens:        10,
			PreserveRecentMessages: 1,
		},
	}

	provider := providers.Get("openai")
	preparer := &RequestPreparer{}

	prepared, res, err := preparer.Prepare(context.Background(), req, modelCfg, provider, nil)
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}

	if res.CompressionApplied {
		t.Errorf("expected no compression applied")
	}

	// Should return the original reference
	prepared["test_mutation"] = true
	if _, ok := req["test_mutation"]; !ok {
		t.Errorf("expected original request to be returned verbatim (same reference)")
	}
	delete(req, "test_mutation")

	// 2. Test case: Compression enabled and threshold exceeded.
	modelCfg.Compression.Enabled = true
	modelCfg.Compression.ThresholdTokens = 2 // Extremely low threshold to trigger compression
	modelCfg.Compression.PreserveRecentMessages = 1

	reqWithHistory := map[string]interface{}{
		"model": "openai/gpt-4o",
		"messages": []interface{}{
			map[string]interface{}{"role": "system", "content": "You are a helpful assistant."},
			map[string]interface{}{"role": "user", "content": "This is a very long log line that is duplicate and should be collapsed: log error. log error. log error."},
			map[string]interface{}{"role": "assistant", "content": "Ok."},
			map[string]interface{}{"role": "user", "content": "What is the error?"}, // Recent message, should be preserved
		},
	}

	preparedComp, resComp, err := preparer.Prepare(context.Background(), reqWithHistory, modelCfg, provider, nil)
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}

	if !resComp.CompressionApplied {
		t.Errorf("expected compression to be applied")
	}

	// Verify original request is NOT mutated
	if _, ok := reqWithHistory["test_mutation"]; ok {
		t.Errorf("original request should not be mutated")
	}

	// Verify system prompt is preserved
	preparedMsgs, ok := preparedComp["messages"].([]interface{})
	if !ok || len(preparedMsgs) == 0 {
		t.Fatalf("expected prepared messages list")
	}

	firstMsg := preparedMsgs[0].(map[string]interface{})
	if firstMsg["role"] != "system" || firstMsg["content"] != "You are a helpful assistant." {
		t.Errorf("expected system message to be preserved at the beginning")
	}

	// Verify recent message is preserved
	lastMsg := preparedMsgs[len(preparedMsgs)-1].(map[string]interface{})
	if lastMsg["role"] != "user" || lastMsg["content"] != "What is the error?" {
		t.Errorf("expected recent message to be preserved at the end")
	}
}

func TestFallbackIsolation(t *testing.T) {
	// Initialize temporary database for settings lookup
	tmpDir, err := os.MkdirTemp("", "airouter_test_fallback_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)
	t.Setenv("HOME", tmpDir)

	if err := db.InitDB(); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}

	// Enable Caveman settings globally
	_, _ = db.DB.Exec("UPDATE settings SET data = ?", `{"rtkEnabled":true,"cavemanEnabled":true,"cavemanLevel":"full"}`)

	req := map[string]interface{}{
		"model": "openai/gpt-4o",
		"messages": []interface{}{
			map[string]interface{}{"role": "user", "content": "hello"},
		},
	}

	modelCfg1 := &db.ModelConfig{
		ID:   "deepseek/deepseek-chat",
		Name: "deepseek-chat",
		Routing: db.RoutingConfig{
			PrimaryProvider: "deepseek",
		},
		Compression: db.CompressionConfig{
			Enabled: true,
		},
	}

	modelCfg2 := &db.ModelConfig{
		ID:   "gemini/gemini-2.5-flash",
		Name: "gemini-2.5-flash",
		Routing: db.RoutingConfig{
			PrimaryProvider: "gemini",
		},
		Compression: db.CompressionConfig{
			Enabled: true,
		},
	}

	preparer := &RequestPreparer{}
	pOpenAI := providers.Get("openai")
	pGemini := providers.Get("gemini")

	// Target 1 preparation
	prepared1, _, err := preparer.Prepare(context.Background(), req, modelCfg1, pOpenAI, nil)
	if err != nil {
		t.Fatalf("Target 1 Prepare failed: %v", err)
	}

	// Verify target 1 has system prompt injected
	msgs1, ok := prepared1["messages"].([]interface{})
	if !ok || len(msgs1) < 2 {
		t.Fatalf("expected injected system prompt in target 1")
	}
	if msgs1[0].(map[string]interface{})["role"] != "system" {
		t.Errorf("expected system message in target 1")
	}

	// Target 2 preparation (completely isolated from target 1's prepared body, starting from original req)
	prepared2, _, err := preparer.Prepare(context.Background(), req, modelCfg2, pGemini, nil)
	if err != nil {
		t.Fatalf("Target 2 Prepare failed: %v", err)
	}

	// Verify original request messages list was not mutated
	if len(req["messages"].([]interface{})) != 1 {
		t.Errorf("original request messages list was mutated!")
	}

	// Verify target 2 has its own systemInstruction
	sysInst, ok := prepared2["systemInstruction"].(map[string]interface{})
	if !ok {
		t.Fatalf("expected systemInstruction in target 2")
	}
	parts, ok := sysInst["parts"].([]interface{})
	if !ok || len(parts) == 0 {
		t.Fatalf("expected systemInstruction parts in target 2")
	}
}

func TestCompressionDisabledRequestVerbatim(t *testing.T) {
	// Initialize temporary database for settings lookup
	tmpDir, err := os.MkdirTemp("", "airouter_test_verbatim_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)
	t.Setenv("HOME", tmpDir)

	if err := db.InitDB(); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}

	// Disable Caveman/Ponytail rewrite globally
	_, _ = db.DB.Exec("UPDATE settings SET data = ?", `{"rtkEnabled":true,"cavemanEnabled":false,"ponytailEnabled":false}`)

	req := map[string]interface{}{
		"model": "openai/gpt-4o",
		"messages": []interface{}{
			map[string]interface{}{"role": "user", "content": "hello world"},
		},
		"temperature": 0.7,
	}

	modelCfg := &db.ModelConfig{
		ID:   "openai/gpt-4o",
		Name: "gpt-4o",
		Routing: db.RoutingConfig{
			PrimaryProvider: "openai",
		},
		Compression: db.CompressionConfig{
			Enabled:                false,
			Trigger:                "threshold",
			ThresholdTokens:        64000,
			PreserveRecentMessages: 20,
		},
	}

	preparer := &RequestPreparer{}
	pOpenAI := providers.Get("openai")

	prepared, res, err := preparer.Prepare(context.Background(), req, modelCfg, pOpenAI, nil)
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}

	if res.Modified {
		t.Errorf("expected res.Modified to be false")
	}

	// Mutate prepared map to verify it is the exact same reference (original request not cloned or mutated)
	prepared["verbatim_check"] = "is_same"
	if val, ok := req["verbatim_check"]; !ok || val != "is_same" {
		t.Errorf("expected original request map to refer to same memory instance (no-op verbatim forwarding)")
	}
}

func TestFallbackModelNameMapping(t *testing.T) {
	// Initialize temporary database for settings lookup
	tmpDir, err := os.MkdirTemp("", "airouter_test_routing_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)
	t.Setenv("HOME", tmpDir)

	if err := db.InitDB(); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}

	// 1. Setup mock connections
	// Connection 1: Primary provider 'deepseek'
	_, _ = db.DB.Exec(
		`INSERT INTO providerConnections (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) 
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"conn-ds", "deepseek", "apikey", "DeepSeek Conn", "test@test.com", 1, 1, `{"apiKey":"sk-ds"}`, "now", "now",
	)
	// Connection 2: Fallback provider 'openai-compatible-sumopod'
	_, _ = db.DB.Exec(
		`INSERT INTO providerConnections (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) 
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"conn-sumo", "openai-compatible-sumopod", "apikey", "Sumopod Conn", "test@test.com", 1, 1, `{"apiKey":"sk-sumo"}`, "now", "now",
	)

	// 2. Setup mock custom model to check fallback name translation
	// We register a custom model 'sumopod/deepseek-v4-flash' under provider 'openai-compatible-sumopod'
	_, _ = db.DB.Exec(
		"INSERT INTO kv (scope, key, value) VALUES (?, ?, ?)",
		db.CustomModelsScope, "openai-compatible-sumopod|sumopod/deepseek-v4-flash|llm", 
		`{"providerAlias":"openai-compatible-sumopod","id":"sumopod/deepseek-v4-flash","type":"llm","name":"Sumo Flash"}`,
	)

	// 3. Setup Model Policy for 'deepseek/deepseek-v4-flash'
	fallbackModel := "openai-compatible-sumopod/sumopod/deepseek-v4-flash"
	modelCfg := &db.ModelConfig{
		ID:   "deepseek/deepseek-v4-flash",
		Name: "deepseek-v4-flash",
		Routing: db.RoutingConfig{
			PrimaryProvider: "deepseek",
			FallbackModel:   &fallbackModel,
		},
	}
	if err := db.SaveModelConfig(modelCfg); err != nil {
		t.Fatalf("failed to save model config: %v", err)
	}

	// 4. Construct GatewayContext
	rec := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/v1/chat/completions", bytes.NewBuffer([]byte(`{"model":"deepseek/deepseek-v4-flash","messages":[]}`)))
	ctx := gwContext.NewGatewayContext(rec, req)
	ctx.RequestBody = map[string]interface{}{"model": "deepseek/deepseek-v4-flash"}
	ctx.Metadata["modelsToTry"] = []string{"deepseek/deepseek-v4-flash"}
	ctx.Metadata["comboKind"] = "direct"

	// 5. Run Routing middleware
	err = Routing(ctx, func(c *gwContext.GatewayContext) error { return nil })
	if err != nil {
		t.Fatalf("Routing middleware failed: %v", err)
	}

	targets, ok := ctx.Metadata["routingTargets"].([]ConnectionModel)
	if !ok || len(targets) != 2 {
		t.Fatalf("expected 2 routing targets (primary + fallback), got: %d", len(targets))
	}

	// Target 1: Primary provider 'deepseek'
	if targets[0].Provider != "deepseek" || targets[0].ModelName != "deepseek-v4-flash" {
		t.Errorf("Target 1 mismatch: Provider=%s, ModelName=%s", targets[0].Provider, targets[0].ModelName)
	}

	// Target 2: Fallback provider 'openai-compatible-sumopod'
	// Should have resolved model name to 'sumopod/deepseek-v4-flash' via custom model match!
	if targets[1].Provider != "openai-compatible-sumopod" || targets[1].ModelName != "sumopod/deepseek-v4-flash" {
		t.Errorf("Target 2 mismatch: Provider=%s, ModelName=%s (expected sumopod/deepseek-v4-flash)", targets[1].Provider, targets[1].ModelName)
	}
}

