package db

import (
	"os"
	"testing"
)

func TestSeamlessAutoMigration(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "airouter_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	t.Setenv("HOME", tmpDir)

	if err := InitDB(); err != nil {
		t.Fatalf("InitDB failed: %v", err)
	}

	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	settings, err := GetSettings()
	if err != nil {
		t.Fatalf("GetSettings failed: %v", err)
	}
	if settings == nil || settings.OptimizationEngine == "" {
		t.Fatalf("expected non-empty settings optimizationEngine")
	}
}
