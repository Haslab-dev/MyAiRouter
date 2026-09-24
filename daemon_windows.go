//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"strings"
	"time"
)

// Pid file lives next to the binary so it works from any disk/dir.
func pidFilePath() string {
	exe, err := os.Executable()
	if err != nil {
		return "myairouter.pid"
	}
	return filepath.Join(filepath.Dir(exe), "myairouter.pid")
}

func findRunningPIDs() []int {
	myPID := os.Getpid()
	out, err := exec.Command("tasklist", "/FI", "IMAGENAME eq myairouter.exe", "/FO", "CSV", "/NH").Output()
	if err != nil {
		return nil
	}
	var pids []int
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Split(strings.TrimSpace(line), `","`)
		if len(fields) < 2 {
			continue
		}
		name := strings.Trim(fields[0], `"`)
		if !strings.EqualFold(name, "myairouter.exe") {
			continue
		}
		if p, e := strconv.Atoi(strings.Trim(fields[1], `"`)); e == nil && p != myPID {
			pids = append(pids, p)
		}
	}
	return pids
}

func killWindowsPIDs(pids []int) {
	if len(pids) == 0 {
		return
	}
	args := []string{"/F"}
	for _, pid := range pids {
		args = append(args, "/PID", strconv.Itoa(pid))
	}
	_ = exec.Command("taskkill", args...).Run()
}

func showStatus() {
	pids := findRunningPIDs()
	if len(pids) == 0 {
		fmt.Println("myairouter: NOT RUNNING")
		return
	}
	if len(pids) == 1 {
		fmt.Printf("myairouter: RUNNING (PID %d)\n", pids[0])
		return
	}
	fmt.Printf("⚠️  WARNING: Multiple (%d) myairouter processes detected!\n", len(pids))
	for i, pid := range pids {
		fmt.Printf("  [%d] PID %d\n", i+1, pid)
	}
	fmt.Println("\nRun 'myairouter stop' to terminate all duplicate instances.")
}

func stopExistingDuplicates() {
	pids := findRunningPIDs()
	if len(pids) > 0 {
		fmt.Printf("Stopping %d existing myairouter process(es)...\n", len(pids))
		killWindowsPIDs(pids)
		time.Sleep(500 * time.Millisecond)
	}
}

func stopProcess() {
	pids := findRunningPIDs()
	if len(pids) == 0 {
		_ = os.Remove(pidFilePath())
		fmt.Println("myairouter not running")
		return
	}
	count := len(pids)
	killWindowsPIDs(pids)
	time.Sleep(500 * time.Millisecond)
	if count == 1 {
		fmt.Printf("myairouter stopped (PID %d)\n", pids[0])
	} else {
		fmt.Printf("myairouter stopped (%d processes terminated: %v)\n", count, pids)
	}
	_ = os.Remove(pidFilePath())
}

func resolveExePath() string {
	// os.Args[0] may be a bare name; Go >=1.19 refuses to exec that (ERR_DOT).
	if exe, err := os.Executable(); err == nil && exe != "" {
		if abs, err := filepath.Abs(exe); err == nil {
			return abs
		}
		return exe
	}
	if p, err := exec.LookPath(os.Args[0]); err == nil {
		if abs, err := filepath.Abs(p); err == nil {
			return abs
		}
		return p
	}
	return os.Args[0]
}

func startBackground() {
	stopExistingDuplicates()

	// Child runs "start -f" directly to avoid re-entering startBackground().
	cmd := exec.Command(resolveExePath(), "start", "-f")
	// Child output goes to a log file so startup crashes stay diagnosable.
	logPath := filepath.Join(filepath.Dir(resolveExePath()), "myairouter.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error opening log file: %v\n", err)
		os.Exit(1)
	}
	defer logFile.Close()
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Env = os.Environ()
	cmd.SysProcAttr = detachedSysProcAttr()
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	_ = os.WriteFile(pidFilePath(), []byte(strconv.Itoa(cmd.Process.Pid)), 0644)
	fmt.Printf("myairouter started (PID %d)\n", cmd.Process.Pid)
	os.Exit(0)
}

func detachedSysProcAttr() *syscall.SysProcAttr {
	const (
		detachedProcess   = 0x00000008
		createNewProcGrp  = 0x00000200
		createNoWindow    = 0x08000000
	)
	return &syscall.SysProcAttr{
		HideWindow: true,
		CreationFlags: detachedProcess |
			createNewProcGrp |
			createNoWindow,
	}
}
