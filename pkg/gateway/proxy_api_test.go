package gateway

import (
	"encoding/json"
	"net/http"
	"testing"
)

// TestProxyRoutesEndToEnd covers the /api/proxies CRUD surface exactly as the
// ProxyPage UI drives it: create → list → toggle → test → delete, plus
// validation and 404 handling.
func TestProxyRoutesEndToEnd(t *testing.T) {
	server := newAuthTestServer(t)
	defer server.Close()

	// Fresh install → dashboard open (requireLogin=false), no session needed.
	resp := doJSON(t, server, http.MethodPost, "/api/proxies", map[string]any{
		"name":      "QA HTTP",
		"scheme":    "http",
		"host":      "proxy.example.com",
		"port":      8080,
		"isEnabled": true,
	}, nil)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("create: got %d", resp.StatusCode)
	}
	var created struct {
		ID        string `json:"id"`
		IsEnabled bool   `json:"isEnabled"`
	}
	err := json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()
	if err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if created.ID == "" || !created.IsEnabled {
		t.Fatalf("bad created route: %+v", created)
	}

	// Validation: missing host/port → 400.
	resp = doJSON(t, server, http.MethodPost, "/api/proxies", map[string]any{"name": "x"}, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing host/port, got %d", resp.StatusCode)
	}

	// List shows the route.
	resp = doJSON(t, server, http.MethodGet, "/api/proxies", nil, nil)
	var list struct {
		Routes []map[string]any `json:"routes"`
	}
	err = json.NewDecoder(resp.Body).Decode(&list)
	resp.Body.Close()
	if err != nil {
		t.Fatalf("list decode: %v", err)
	}
	if len(list.Routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(list.Routes))
	}

	// Disable via PATCH.
	resp = doJSON(t, server, http.MethodPatch, "/api/proxies/"+created.ID, map[string]any{"isEnabled": false}, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch: got %d", resp.StatusCode)
	}

	// Test endpoint works even on a disabled route; dead proxy → valid=false JSON.
	resp = doJSON(t, server, http.MethodPost, "/api/proxies/test/"+created.ID, nil, nil)
	var testRes struct {
		Valid bool   `json:"valid"`
		Error string `json:"error"`
	}
	err = json.NewDecoder(resp.Body).Decode(&testRes)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("test-on-disabled should be 200 JSON, got %d", resp.StatusCode)
	}
	if testRes.Valid {
		t.Fatalf("dead proxy must not report valid; error=%q", testRes.Error)
	}

	// Delete.
	resp = doJSON(t, server, http.MethodDelete, "/api/proxies/"+created.ID, nil, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete: got %d", resp.StatusCode)
	}

	// Test on a missing route → 404.
	resp = doJSON(t, server, http.MethodPost, "/api/proxies/test/proxy-missing", nil, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing route test: got %d", resp.StatusCode)
	}
}
