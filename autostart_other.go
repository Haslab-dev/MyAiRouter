//go:build !windows

package main

import (
	"fmt"
	"os"
)

// Non-Windows stubs: real implementations use systemd user units
// (~/.config/systemd/user/myairouter.service) — add when a unix deploy matters.
func installAutostart() {
	fmt.Fprintln(os.Stderr, "Error: auto-start install is not implemented on this platform yet.")
	os.Exit(1)
}

func uninstallAutostart() {
	fmt.Println("myairouter: auto-start is not implemented on this platform.")
}
