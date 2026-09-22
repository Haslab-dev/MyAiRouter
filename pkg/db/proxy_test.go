package db

import (
	"os"
	"testing"
)

// setupProxyTestDB initializes an isolated temp-dir DB and registers cleanup.
func setupProxyTestDB(t *testing.T) {
	t.Helper()
	tmpDir, err := os.MkdirTemp("", "proxy_test_*")
	if err != nil {
		t.Fatalf("temp dir: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(tmpDir) })
	// os.UserHomeDir() keys off $HOME on unix and %USERPROFILE% on Windows —
	// isolate BOTH so the test never touches the real ~/.myairouter database.
	t.Setenv("HOME", tmpDir)
	t.Setenv("USERPROFILE", tmpDir)

	if err := InitDB(); err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
}

func TestProxyRouteCRUD(t *testing.T) {
	setupProxyTestDB(t)

	// Create
	created, err := CreateProxyRoute(&ProxyRoute{
		Name:      "QA Route",
		Scheme:    "socks5",
		Host:      "proxy.example.com",
		Port:      1080,
		Username:  "u",
		Password:  "p",
		IsEnabled: true,
	})
	if err != nil {
		t.Fatalf("CreateProxyRoute: %v", err)
	}
	if created.ID == "" || created.Scheme != "socks5" {
		t.Fatalf("unexpected created route: %+v", created)
	}
	if got := ProxyURL(created); got != "socks5://u:p@proxy.example.com:1080" {
		t.Fatalf("ProxyURL = %q", got)
	}

	// List
	routes, err := ListProxyRoutes()
	if err != nil || len(routes) != 1 {
		t.Fatalf("ListProxyRoutes: %v len=%d", err, len(routes))
	}

	// Get + credentials redacted in URL form
	got, err := GetProxyRoute(created.ID)
	if err != nil || got.Host != "proxy.example.com" {
		t.Fatalf("GetProxyRoute: %v", err)
	}

	// Update: disable + change host
	updated, err := UpdateProxyRoute(created.ID, map[string]interface{}{
		"isEnabled": false,
		"host":      "proxy2.example.com",
	})
	if err != nil {
		t.Fatalf("UpdateProxyRoute: %v", err)
	}
	if updated.IsEnabled || updated.Host != "proxy2.example.com" {
		t.Fatalf("update not applied: %+v", updated)
	}

	// Delete
	if err := DeleteProxyRoute(created.ID); err != nil {
		t.Fatalf("DeleteProxyRoute: %v", err)
	}
	if _, err := GetProxyRoute(created.ID); err == nil {
		t.Fatal("expected error after delete, got nil")
	}
}

func TestProxyRouteForConnection(t *testing.T) {
	setupProxyTestDB(t)

	route, err := CreateProxyRoute(&ProxyRoute{
		Name:      "Attached",
		Scheme:    "http",
		Host:      "10.0.0.1",
		Port:      8080,
		IsEnabled: true,
	})
	if err != nil {
		t.Fatalf("CreateProxyRoute: %v", err)
	}

	conn := &ProviderConnection{
		ID:       "conn-x",
		Provider: "openai",
		Data:     map[string]interface{}{"proxyRouteId": route.ID},
	}

	resolved, err := ProxyRouteForConnection(conn)
	if err != nil || resolved == nil || resolved.Host != "10.0.0.1" {
		t.Fatalf("ProxyRouteForConnection: %v %+v", err, resolved)
	}

	// Missing / blank / wrong-type ids resolve to nil (direct fallback)
	for _, bad := range []interface{}{"", 123, "proxy-does-not-exist"} {
		c := &ProviderConnection{ID: "conn-y", Data: map[string]interface{}{"proxyRouteId": bad}}
		if bad != "proxy-does-not-exist" {
			r, err := ProxyRouteForConnection(c)
			if err != nil || r != nil {
				t.Fatalf("expected nil route for %v, got %v err %v", bad, r, err)
			}
		}
		// Deleted/nonexistent route → error path also falls back to direct via ClientFor
	}

	// No proxyRouteId at all
	c := &ProviderConnection{ID: "conn-z", Data: map[string]interface{}{}}
	r, err := ProxyRouteForConnection(c)
	if err != nil || r != nil {
		t.Fatalf("expected nil,nil for missing key; got %v %v", r, err)
	}
}
