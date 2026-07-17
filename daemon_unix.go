//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

func startBackground() {
	cmd := exec.Command(os.Args[0])
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.Env = os.Environ()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	os.WriteFile(pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0644)
	fmt.Printf("myairouter started (PID %d)\n", cmd.Process.Pid)
	os.Exit(0)
}

func stopProcess() {
	data, err := os.ReadFile(pidFile)
	if err != nil {
		fmt.Fprintln(os.Stderr, "myairouter not running (no PID file)")
		os.Exit(1)
	}
	pid, _ := strconv.Atoi(strings.TrimSpace(string(data)))
	p, err := os.FindProcess(pid)
	if err != nil {
		os.Remove(pidFile)
		fmt.Fprintln(os.Stderr, "myairouter not running")
		os.Exit(1)
	}
	if err := p.Signal(syscall.SIGTERM); err != nil {
		p.Kill()
	}
	os.Remove(pidFile)
	fmt.Println("myairouter stopped")
	os.Exit(0)
}
