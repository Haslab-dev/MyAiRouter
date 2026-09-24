//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func pidFilePath() string {
	exe, err := os.Executable()
	if err != nil {
		return "myairouter.pid"
	}
	return filepath.Join(filepath.Dir(exe), "myairouter.pid")
}

func findRunningPIDs() []int {
	myPID := os.Getpid()
	out, err := exec.Command("pgrep", "-f", "myairouter").Output()
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

	os.Remove(pidFilePath())
}

func stopProcess() {
	pids := findRunningPIDs()
	if len(pids) == 0 {
		os.Remove(pidFilePath())
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

func resolveExePath() string {
	// os.Args[0] may be a bare name; Go >=1.19 refuses to exec that (ERR_DOT).
	if exe, err := os.Executable(); err == nil && exe != "" {
		return exe
	}
	if p, err := exec.LookPath(os.Args[0]); err == nil {
		return p
	}
	return os.Args[0]
}

func startBackground() {
	stopExistingDuplicates()

	exe := resolveExePath()
	cmd := exec.Command(exe, "start", "-f")
	// Child output goes to a log file so startup crashes stay diagnosable.
	logPath := filepath.Join(filepath.Dir(exe), "myairouter.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		// Dir next to the binary may not be writable (e.g. /usr/local/bin);
		// fall back to the data dir.
		if home, herr := os.UserHomeDir(); herr == nil {
			logPath = filepath.Join(home, ".myairouter", "myairouter.log")
			_ = os.MkdirAll(filepath.Dir(logPath), 0755)
			logFile, err = os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
		}
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error opening log file: %v\n", err)
		os.Exit(1)
	}
	defer logFile.Close()
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Env = os.Environ()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	_ = os.WriteFile(pidFilePath(), []byte(strconv.Itoa(cmd.Process.Pid)), 0644)
	fmt.Printf("myairouter started (PID %d)\n", cmd.Process.Pid)
	os.Exit(0)
}
