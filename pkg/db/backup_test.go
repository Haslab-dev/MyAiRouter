package db

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBackupNow(t *testing.T) {
	tmp, err := os.MkdirTemp("", "jr_backup_*")
	if err != nil {
		t.Fatalf("temp: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(tmp) })
	t.Setenv("HOME", tmp)
	t.Setenv("USERPROFILE", tmp)
	if err := InitDB(); err != nil {
		t.Fatalf("InitDB: %v", err)
	}

	path, err := BackupNow()
	if err != nil {
		t.Fatalf("BackupNow: %v", err)
	}
	if !strings.HasPrefix(filepath.Base(path), "db-") || !strings.HasSuffix(path, ".sqlite") {
		t.Fatalf("unexpected backup name: %s", path)
	}
	if fi, err := os.Stat(path); err != nil || fi.Size() == 0 {
		t.Fatalf("backup missing or empty: %v", err)
	}

	// Retention: create 10 backups, only backupRetention (7) survive.
	for i := 0; i < 10; i++ {
		if _, err := BackupNow(); err != nil {
			t.Fatalf("backup %d: %v", i, err)
		}
	}
	entries, _ := os.ReadDir(filepath.Join(tmp, ".myairouter", "backups"))
	if len(entries) != backupRetention {
		t.Fatalf("backups = %d, want %d", len(entries), backupRetention)
	}
}

func TestApiKeyScope(t *testing.T) {
	tmp, err := os.MkdirTemp("", "jr_scope_*")
	if err != nil {
		t.Fatalf("temp: %v", err)
	}
	t.Cleanup(func() { os.RemoveAll(tmp) })
	t.Setenv("HOME", tmp)
	t.Setenv("USERPROFILE", tmp)
	if err := InitDB(); err != nil {
		t.Fatalf("InitDB: %v", err)
	}

	key, err := CreateApiKey("scoped")
	if err != nil {
		t.Fatalf("CreateApiKey: %v", err)
	}

	// Empty scope = unrestricted.
	if !key.ModelAllowed("anything") || key.DailyLimitExceeded() {
		t.Fatal("empty scope must be unrestricted")
	}

	// Allowlist blocks other models.
	scope := ApiKeyScope{AllowedModels: []string{"Collabs", "openai/gpt-4o"}, DailyTokenLimit: 100}
	if err := UpdateApiKeyScope(key.ID, scope); err != nil {
		t.Fatalf("UpdateApiKeyScope: %v", err)
	}

	found, err := FindApiKeyByValue(key.Key)
	if err != nil {
		t.Fatalf("FindApiKeyByValue: %v", err)
	}
	if found.Scope.DailyTokenLimit != 100 || len(found.Scope.AllowedModels) != 2 {
		t.Fatalf("scope not persisted: %+v", found.Scope)
	}
	if !found.ModelAllowed("Collabs") || found.ModelAllowed("deepseek/deepseek-chat") {
		t.Fatal("allowlist not enforced")
	}
}
