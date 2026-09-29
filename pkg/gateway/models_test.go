package gateway

import (
	"encoding/json"
	"net/http"
	"testing"

	"myAiRouter/pkg/db"
)

func TestAvailableModelsList(t *testing.T) {
	server := newAuthTestServer(t)
	defer server.Close()

	// 1. Add connection for sumopod
	conn := db.ProviderConnection{
		ID:        "sumopod-conn-1",
		Provider:  "sumopod",
		AuthType:  "apikey",
		IsActive:  true,
		Data:      map[string]interface{}{"apiKey": "test-key"},
		CreatedAt: "2026-01-01T00:00:00Z",
		UpdatedAt: "2026-01-01T00:00:00Z",
	}
	if _, err := db.CreateConnection(&conn); err != nil {
		t.Fatalf("CreateConnection: %v", err)
	}

	// Add custom models for sumopod
	if _, err := db.AddCustomModel(&db.CustomModel{
		ProviderAlias: "sumopod",
		ID:            "qwen3.6-flash",
		Type:          "llm",
		Name:          "qwen3.6-flash",
	}); err != nil {
		t.Fatalf("AddCustomModel: %v", err)
	}
	if _, err := db.AddCustomModel(&db.CustomModel{
		ProviderAlias: "sumopod",
		ID:            "disabled-custom-model",
		Type:          "llm",
		Name:          "disabled-custom-model",
	}); err != nil {
		t.Fatalf("AddCustomModel: %v", err)
	}

	// 2. Set enabled models whitelist: only qwen3.6-flash
	if err := db.SetEnabledModels("sumopod", []string{"qwen3.6-flash"}); err != nil {
		t.Fatalf("SetEnabledModels: %v", err)
	}

	// 3. GET /api/models (default, available models only)
	resp := doJSON(t, server, http.MethodGet, "/api/models", nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/models: status %d", resp.StatusCode)
	}
	var res struct {
		Data []ModelListEntry `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		t.Fatalf("Decode: %v", err)
	}
	resp.Body.Close()

	// Should only have sumopod/qwen3.6-flash, and NOT deepseek-r1 (default model) or disabled-custom-model
	foundQwen := false
	for _, m := range res.Data {
		if m.ID == "sumopod/qwen3.6-flash" {
			foundQwen = true
		}
		if m.ID == "sumopod/disabled-custom-model" {
			t.Fatalf("Found disabled model %s in available models list", m.ID)
		}
		if m.ID == "sumopod/deepseek-r1" {
			t.Fatalf("Found non-whitelisted default model %s in available models list", m.ID)
		}
	}
	if !foundQwen {
		t.Fatalf("Expected sumopod/qwen3.6-flash in /api/models, but got: %+v", res.Data)
	}

	// 4. GET /api/models?all=true (full catalog for provider admin)
	respAll := doJSON(t, server, http.MethodGet, "/api/models?all=true", nil, nil)
	if respAll.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/models?all=true: status %d", respAll.StatusCode)
	}
	var resAll struct {
		Data []ModelListEntry `json:"data"`
	}
	if err := json.NewDecoder(respAll.Body).Decode(&resAll); err != nil {
		t.Fatalf("Decode all: %v", err)
	}
	respAll.Body.Close()

	foundDisabledCustom := false
	for _, m := range resAll.Data {
		if m.ID == "sumopod/disabled-custom-model" {
			foundDisabledCustom = true
			break
		}
	}
	if !foundDisabledCustom {
		t.Fatalf("Expected sumopod/disabled-custom-model in /api/models?all=true, but got: %+v", resAll.Data)
	}
}
