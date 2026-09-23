//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// installGlobal copies the running binary to %USERPROFILE%\.local\bin and
// ensures that directory is on the user PATH, so `myairouter` works from any
// terminal (cmd, PowerShell, baru dibuka) tanpa path manual.
func installGlobal() {
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error resolving executable path: %v\n", err)
		os.Exit(1)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error resolving home directory: %v\n", err)
		os.Exit(1)
	}
	binDir := filepath.Join(home, ".local", "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Error creating %s: %v\n", binDir, err)
		os.Exit(1)
	}
	dst := filepath.Join(binDir, "myairouter.exe")
	if !strings.EqualFold(exe, dst) {
		raw, err := os.ReadFile(exe)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error reading %s: %v\n", exe, err)
			os.Exit(1)
		}
		if err := os.WriteFile(dst, raw, 0755); err != nil {
			fmt.Fprintf(os.Stderr, "Error installing to %s: %v\n", dst, err)
			os.Exit(1)
		}
	}
	// Append binDir to the USER PATH via setx if missing.
	cur := os.Getenv("PATH")
	found := false
	for _, p := range strings.Split(cur, ";") {
		if strings.EqualFold(strings.TrimRight(p, `\/`), binDir) {
			found = true
			break
		}
	}
	if !found {
		cmd := exec.Command("setx", "PATH", cur+";"+binDir)
		if out, err := cmd.CombinedOutput(); err != nil {
			fmt.Fprintf(os.Stderr, "Installed to %s but PATH update failed: %v\n%s\nAdd manually: setx PATH \"%%PATH%%;%s\"\n", dst, err, out, binDir)
			os.Exit(1)
		}
		fmt.Printf("myairouter installed globally to %s\nPATH updated — buka terminal BARU lalu jalankan: myairouter status\n", dst)
		return
	}
	fmt.Printf("myairouter installed globally to %s (already on PATH).\n", dst)
}
