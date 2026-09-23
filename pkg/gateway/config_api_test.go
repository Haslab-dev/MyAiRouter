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
