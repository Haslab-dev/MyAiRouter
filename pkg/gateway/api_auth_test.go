package gateway

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"myAiRouter/pkg/db"
)

func newAuthTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	tmp, err := os.MkdirTemp("", "airouter_auth_*")
	if err != nil {
		t.Fatalf("MkdirTemp: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(tmp) })
	// os.UserHomeDir() keys off $HOME on unix and %USERPROFILE% on Windows,
	// so isolate both to keep the test off the real ~/.myairouter database.
	t.Setenv("HOME", tmp)
	t.Setenv("USERPROFILE", tmp)
	if err := db.InitDB(); err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	if err := db.RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	mux := http.NewServeMux()
	RegisterAdminRoutes(mux)
	return httptest.NewServer(mux)
}

func doJSON(t *testing.T, server *httptest.Server, method, path string, body map[string]any, cookie *http.Cookie) (*http.Response) {
	t.Helper()
	var bodyReader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("Marshal: %v", err)
		}
		bodyReader = bytes.NewReader(raw)
	} else {
		bodyReader = bytes.NewReader(nil)
	}
	req, err := http.NewRequest(method, server.URL+path, bodyReader)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

func TestLoginFlowAndAdminGate(t *testing.T) {
	server := newAuthTestServer(t)
	defer server.Close()

	// Fresh install: dashboard open by default, status reports no password set.
	resp := doJSON(t, server, http.MethodGet, "/api/auth/status", nil, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d", resp.StatusCode)
	}

	// Enable login while the gate is still open.
	resp = doJSON(t, server, http.MethodPatch, "/api/settings", map[string]any{"requireLogin": true}, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("enable login: got %d", resp.StatusCode)
	}

	// Admin routes are now denied without a session.
	resp = doJSON(t, server, http.MethodGet, "/api/providers", nil, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("providers without session: got %d, want 401", resp.StatusCode)
	}

	// Wrong password → 401 with a useful message.
	resp = doJSON(t, server, http.MethodPost, "/api/auth/login", map[string]any{"password": "nope"}, nil)
	var errBody map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&errBody)
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("bad login: got %d", resp.StatusCode)
	}

	// Correct default password → session cookie issued.
	resp = doJSON(t, server, http.MethodPost, "/api/auth/login", map[string]any{"password": "123456789"}, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("good login: got %d", resp.StatusCode)
	}
	setCookie := resp.Header.Get("Set-Cookie")
	if !strings.HasPrefix(setCookie, "session=") {
		t.Fatalf("no session cookie in: %q", setCookie)
	}
	name := setCookie[:strings.Index(setCookie, "=")]
	value := setCookie[len(name)+1 : strings.Index(setCookie, ";")]
	cookie := &http.Cookie{Name: name, Value: value}

	// Authenticated access works.
	resp = doJSON(t, server, http.MethodGet, "/api/providers", nil, cookie)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("providers with session: got %d", resp.StatusCode)
	}

	// Logout invalidates the session.
	resp = doJSON(t, server, http.MethodPost, "/api/auth/logout", nil, cookie)
	resp.Body.Close()
	if resp.Body == nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("logout: got %d", resp.StatusCode)
	}
	resp = doJSON(t, server, http.MethodGet, "/api/providers", nil, cookie)
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("providers after logout: got %d, want 401", resp.StatusCode)
	}
}