//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func findRunningPIDs() []int {
	myPID := os.Getpid()
	out, err := exec.Command("pgrep", "-f", "my[aA]i[rR]outer").Output()
	var pids []int
	if err == nil {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			if p, e := strconv.Atoi(line); e == nil && p != myPID {
				pids = append(pids, p)
			}
		}
	}
	return pids
}

func showStatus() {
	pids := findRunningPIDs()
	if len(pids) == 0 {
		fmt.Println("myairouter: NOT RUNNING")
		return
	}

	if len(pids) == 1 {
		fmt.Printf("myairouter: RUNNING (PID %d)\n", pids[0])
		showPIDInfo(pids[0])
		return
	}

	fmt.Printf("⚠️  WARNING: Multiple (%d) myairouter processes detected!\n", len(pids))
	for i, pid := range pids {
		fmt.Printf("  [%d] PID %d\n", i+1, pid)
		showPIDInfo(pid)
	}
	fmt.Println("\nRun 'myairouter stop' to terminate all duplicate instances.")
}

func showPIDInfo(pid int) {
	out, err := exec.Command("lsof", "-p", strconv.Itoa(pid), "-iTCP", "-sTCP:LISTEN").Output()
	if err == nil && len(out) > 0 {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		if len(lines) > 1 {
			fields := strings.Fields(lines[1])
			if len(fields) >= 9 {
				fmt.Printf("      Listening on: %s\n", fields[len(fields)-1])
			}
		}
	}
}

func stopExistingDuplicates() {
	pids := findRunningPIDs()
	if len(pids) > 0 {
		fmt.Printf("Stopping %d existing myairouter process(es)...\n", len(pids))
		stopProcessInternal(pids)
		time.Sleep(500 * time.Millisecond)
	}
}

func stopProcessInternal(pids []int) {
	if len(pids) == 0 {
		return
	}
	for _, pid := range pids {
		p, err := os.FindProcess(pid)
		if err == nil {
			_ = p.Signal(syscall.SIGTERM)
		}
	}

	time.Sleep(500 * time.Millisecond)

	remaining := findRunningPIDs()
	for _, pid := range remaining {
		if p, err := os.FindProcess(pid); err == nil {
			_ = p.Kill()
		}
	}

	os.Remove(pidFile)
}

func stopProcess() {
	pids := findRunningPIDs()
	if len(pids) == 0 {
		os.Remove(pidFile)
		fmt.Println("myairouter not running")
		return
	}

	count := len(pids)
	stopProcessInternal(pids)

	if count == 1 {
		fmt.Printf("myairouter stopped (PID %d)\n", pids[0])
	} else {
		fmt.Printf("myairouter stopped (%d processes terminated: %v)\n", count, pids)
	}
}

func startBackground() {
	stopExistingDuplicates()

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
