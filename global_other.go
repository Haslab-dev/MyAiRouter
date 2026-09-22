//go:build !windows

package main

import (
	"fmt"
	"os"
)

// Non-Windows stub: global install is handled by website/install.sh
// (copies to ~/.local/bin or /usr/local/bin, both on PATH).
func installGlobal() {
	fmt.Fprintln(os.Stderr, "Use: ./website/install.sh --local (installs to ~/.local/bin/myairouter, on PATH).")
	os.Exit(1)
}
