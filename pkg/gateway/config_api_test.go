package gateway

import (
	"encoding/json"
	"net/http"
	"testing"
)

// TestConfigExportImport round-trips a configuration bundle through the
// export and import handlers using an isolated test database.
func TestConfigExportImport(t *testing.T) {
	server := newAuthTestServer(t)
	defer server.Close()

	// Seed: one provider connection and one combo.
	resp := doJSON(t, server, http.MethodPost, "/api/providers", map[string]any{
		"provider": "qa-provider",
		"name":     "QA Conn",
		"authType": "api_key",
		"data":     map[string]any{"apiKey": "sk-qa", "baseUrl": "https://qa.example.com"},
	}, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("seed provider: got %d", resp.StatusCode)
	}

	resp = doJSON(t, server, http.MethodPost, "/api/combos", map[string]any{
		"name":   "qa-route",
		"kind":   "fallback",
		"models": []string{"qa-provider/model-a", "qa-provider/model-b"},
	}, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("seed combo: got %d", resp.StatusCode)
	}

	// Export.
	resp = doJSON(t, server, http.MethodGet, "/api/config/export", nil, nil)
	var bundle map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&bundle); err != nil {
		t.Fatalf("export decode: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("export: got %d", resp.StatusCode)
	}

	providers, _ := bundle["providers"].([]any)
	if len(providers) != 1 {
		t.Fatalf("export providers = %d, want 1", len(providers))
	}
	// Password hash must never be exported.
	if settings, ok := bundle["settings"].(map[string]any); ok {
		if _, leak := settings["passwordHash"]; leak {
			t.Fatal("export leaked passwordHash")
		}
	}

	// Re-import the same bundle (idempotent update path).
	resp = doJSON(t, server, http.MethodPost, "/api/config/import", bundle, nil)
	var importRes struct {
		Success  bool         `json:"success"`
		Restored map[string]int `json:"restored"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&importRes); err != nil {
		t.Fatalf("import decode: %v", err)
	}
	resp.Body.Close()
	if !importRes.Success || importRes.Restored["providers"] != 1 {
		t.Fatalf("import failed: %+v", importRes)
	}

	// The imported provider must still resolve.
	resp = doJSON(t, server, http.MethodGet, "/api/providers", nil, nil)
	var conns []map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&conns)
	resp.Body.Close()
	if len(conns) != 1 {
		t.Fatalf("providers after import = %d, want 1 (import must not duplicate)", len(conns))
	}
}

func TestProviderCredentialPatchAndComboValidation(t *testing.T) {
	server := newAuthTestServer(t)
	defer server.Close()

	// Create provider connection with a real API key.
	resp := doJSON(t, server, http.MethodPost, "/api/providers", map[string]any{
		"provider": "openai",
		"name":     "Initial",
		"authType": "apikey",
		"isActive": true,
		"data":     map[string]any{"apiKey": "sk-real-key-abcdef123456"},
	}, nil)
	var created map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create provider: got %d", resp.StatusCode)
	}
	id, _ := created["id"].(string)
	if data, _ := created["data"].(map[string]any); data["apiKey"] == "sk-real-key-abcdef123456" {
		t.Fatalf("POST /api/providers leaked unmasked apiKey")
	}

	// Patch with a masked apiKey (simulating an edit without changing key).
	resp = doJSON(t, server, http.MethodPatch, "/api/providers/"+id, map[string]any{
		"name": "Updated",
		"data": map[string]any{"apiKey": "sk***56", "modelPrefix": "oa/"},
	}, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch provider: got %d", resp.StatusCode)
	}

	// Verify real key in DB is still intact via GET /api/config/export (unmasked export).
	resp = doJSON(t, server, http.MethodGet, "/api/config/export", nil, nil)
	var bundle map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&bundle)
	resp.Body.Close()
	providers, _ := bundle["providers"].([]any)
	p0, _ := providers[0].(map[string]any)
	pData, _ := p0["data"].(map[string]any)
	if pData["apiKey"] != "sk-real-key-abcdef123456" {
		t.Fatalf("apiKey was overwritten by masked value: got %v", pData["apiKey"])
	}

	// Combo validation: empty models rejected, duplicate name rejected.
	resp = doJSON(t, server, http.MethodPost, "/api/combos", map[string]any{
		"name":   "empty-combo",
		"kind":   "fallback",
		"models": []string{},
	}, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty combo models: got %d, want 400", resp.StatusCode)
	}

	resp = doJSON(t, server, http.MethodPost, "/api/combos", map[string]any{
		"name":   "valid-combo",
		"kind":   "fallback",
		"models": []string{"openai/gpt-4o"},
	}, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("valid combo: got %d", resp.StatusCode)
	}

	resp = doJSON(t, server, http.MethodPost, "/api/combos", map[string]any{
		"name":   "Valid-Combo",
		"kind":   "fallback",
		"models": []string{"openai/gpt-4o-mini"},
	}, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate combo: got %d, want 409", resp.StatusCode)
	}
}
