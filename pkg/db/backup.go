package db

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const backupRetention = 7

// BackupDir returns ~/.myairouter/backups, creating it if needed.
func BackupDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".myairouter", "backups")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

// BackupNow creates a consistent snapshot of the SQLite database into
// ~/.myairouter/backups/db-YYYYMMDD-HHMMSS.sqlite via `VACUUM INTO` (safe
// against concurrent writes, unlike a plain file copy), then prunes backups
// beyond the retention window.
func BackupNow() (string, error) {
	if DB == nil {
		return "", fmt.Errorf("database not initialized")
	}
	dir, err := BackupDir()
	if err != nil {
		return "", err
	}
	base := "db-" + time.Now().Format("20060102-150405")

	// VACUUM INTO refuses to overwrite an existing file, so two backups inside
	// the same second (or a manual backup right after the daily one) need a
	// distinct suffix instead of failing.
	var dstPath string
	for i := 0; ; i++ {
		name := base + ".sqlite"
		if i > 0 {
			name = fmt.Sprintf("%s-%d.sqlite", base, i)
		}
		dstPath = filepath.Join(dir, name)
		if _, err := os.Stat(dstPath); os.IsNotExist(err) {
			break
		}
	}

	if _, err := DB.Exec("VACUUM INTO ?", dstPath); err != nil {
		return "", fmt.Errorf("backup failed: %w", err)
	}
	pruneOldBackups(dir)
	return dstPath, nil
}

// StartBackupScheduler backs up daily in the background. The first run fires
// shortly after boot so a fresh install is protected day one; subsequent runs
// tick every 24h (a laptop that was off simply backs up on the next tick).
func StartBackupScheduler() {
	if DB == nil {
		return
	}
	go func() {
		time.Sleep(2 * time.Minute)
		_, _ = BackupNow()
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			_, _ = BackupNow()
		}
	}()
}

func pruneOldBackups(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var backups []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "db-") && strings.HasSuffix(e.Name(), ".sqlite") {
			backups = append(backups, e.Name())
		}
	}
	// Names sort chronologically (zero-padded timestamp).
	sort.Strings(backups)
	for len(backups) > backupRetention {
		_ = os.Remove(filepath.Join(dir, backups[0]))
		backups = backups[1:]
	}
}
