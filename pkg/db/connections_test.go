package db

import (
	"os"
	"testing"
)

func setupTestDB(t *testing.T) {
	t.Helper()
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)
	if err := InitDB(); err != nil {
		t.Fatalf("InitDB: %v", err)
	}
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}
	t.Cleanup(func() {
		if DB != nil {
			_ = DB.Close()
			DB = nil
		}
		_ = os.RemoveAll(tmpDir)
	})
}

func TestUpdateConnection_PreservesSecretsAgainstMaskedAndEmpty(t *testing.T) {
	setupTestDB(t)

	conn, err := CreateConnection(&ProviderConnection{
		Provider: "openai",
		AuthType: "apikey",
		Name:     "ProdKey",
		Priority: 1,
		IsActive: true,
		Data: map[string]interface{}{
			"apiKey":       "  sk-real-secret-key-123456  ",
			"accessToken":  "tok-real-access-9999",
			"proxyRouteId": "proxy-1",
		},
	})
	if err != nil {
		t.Fatalf("CreateConnection: %v", err)
	}
	if got := conn.Data["apiKey"]; got != "sk-real-secret-key-123456" {
		t.Fatalf("CreateConnection did not trim apiKey: got %q", got)
	}

	// Updating other fields with masked/empty secrets must preserve real secrets,
	// and clearing proxyRouteId ("") must remove proxyRouteId from Data.
	updated, err := UpdateConnection(conn.ID, map[string]interface{}{
		"name":     "Renamed",
		"priority": 2,
		"data": map[string]interface{}{
			"apiKey":       "sk***56",
			"accessToken":  "***",
			"refreshToken": "",
			"modelPrefix":  "custom/",
			"proxyRouteId": "",
		},
	})
	if err != nil {
		t.Fatalf("UpdateConnection: %v", err)
	}
	if updated.Name != "Renamed" || updated.Priority != 2 {
		t.Fatalf("top-level fields not updated: %+v", updated)
	}
	if got := updated.Data["apiKey"]; got != "sk-real-secret-key-123456" {
		t.Fatalf("masked apiKey overwrote real secret: got %q", got)
	}
	if got := updated.Data["accessToken"]; got != "tok-real-access-9999" {
		t.Fatalf("masked accessToken overwrote real secret: got %q", got)
	}
	if got := updated.Data["modelPrefix"]; got != "custom/" {
		t.Fatalf("modelPrefix = %q, want custom/", got)
	}
	if _, exists := updated.Data["proxyRouteId"]; exists {
		t.Fatalf("expected proxyRouteId to be deleted when cleared")
	}

	// Providing a new non-masked apiKey should update and trim it.
	updated2, err := UpdateConnection(conn.ID, map[string]interface{}{
		"data": map[string]interface{}{
			"apiKey": "  sk-new-secret-key-7890  ",
		},
	})
	if err != nil {
		t.Fatalf("UpdateConnection new key: %v", err)
	}
	if got := updated2.Data["apiKey"]; got != "sk-new-secret-key-7890" {
		t.Fatalf("new apiKey not saved/trimmed: got %q", got)
	}
}
