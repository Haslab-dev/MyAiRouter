//go:build !windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

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
	dst := filepath.Join(binDir, "myairouter")
	if exe != dst {
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
	found := false
	for _, p := range strings.Split(os.Getenv("PATH"), ":") {
		if p == binDir {
			found = true
			break
		}
	}
	if !found {
		fmt.Printf("myairouter installed to %s\nAdd to PATH: export PATH=\"$HOME/.local/bin:$PATH\"\n", dst)
		return
	}
	fmt.Printf("myairouter installed globally to %s (already on PATH).\n", dst)
}
