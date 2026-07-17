//go:build windows

package main

import (
	"fmt"
	"os"
)

func startBackground() {
	fmt.Fprintln(os.Stderr, "background daemon not supported on Windows")
	os.Exit(1)
}

func stopProcess() {
	fmt.Fprintln(os.Stderr, "background daemon not supported on Windows")
	os.Exit(1)
}
