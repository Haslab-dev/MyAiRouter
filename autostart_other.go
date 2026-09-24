//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func systemdUnit(exe string) string {
	return `[Unit]
Description=MyAiRouter Gateway
After=network-online.target

[Service]
ExecStart=` + exe + ` start -f
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`
}

func launchdPlist(exe string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>com.myairouter.gateway</string>
	<key>ProgramArguments</key>
	<array><string>` + exe + `</string><string>start</string><string>-f</string></array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
</dict>
</plist>
`
}

func installAutostart() {
	exe := resolveExePath()
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error resolving home directory: %v\n", err)
			os.Exit(1)
		}
		dst := filepath.Join(home, "Library", "LaunchAgents", "com.myairouter.gateway.plist")
		if err := os.WriteFile(dst, []byte(launchdPlist(exe)), 0644); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing %s: %v\n", dst, err)
			os.Exit(1)
		}
		_ = exec.Command("launchctl", "unload", dst).Run()
		if err := exec.Command("launchctl", "load", dst).Run(); err != nil {
			fmt.Fprintf(os.Stderr, "Error loading launchd job: %v\n", err)
			os.Exit(1)
		}
	default:
		home, err := os.UserHomeDir()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error resolving home directory: %v\n", err)
			os.Exit(1)
		}
		dst := filepath.Join(home, ".config", "systemd", "user", "myairouter.service")
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			fmt.Fprintf(os.Stderr, "Error creating %s: %v\n", filepath.Dir(dst), err)
			os.Exit(1)
		}
		if err := os.WriteFile(dst, []byte(systemdUnit(exe)), 0644); err != nil {
			fmt.Fprintf(os.Stderr, "Error writing %s: %v\n", dst, err)
			os.Exit(1)
		}
		for _, args := range [][]string{
			{"--user", "daemon-reload"},
			{"--user", "enable", "--now", "myairouter.service"},
		} {
			if err := exec.Command("systemctl", args...).Run(); err != nil {
				fmt.Fprintf(os.Stderr, "Error running systemctl %v: %v\n", args, err)
				os.Exit(1)
			}
		}
	}
	fmt.Println("myairouter installed: auto-start on boot + crash watchdog.\nRemove with: myairouter uninstall")
}

func uninstallAutostart() {
	switch runtime.GOOS {
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error resolving home directory: %v\n", err)
			os.Exit(1)
		}
		dst := filepath.Join(home, "Library", "LaunchAgents", "com.myairouter.gateway.plist")
		_ = exec.Command("launchctl", "unload", dst).Run()
		_ = os.Remove(dst)
	default:
		_ = exec.Command("systemctl", "--user", "disable", "--now", "myairouter.service").Run()
		if home, err := os.UserHomeDir(); err == nil {
			_ = os.Remove(filepath.Join(home, ".config", "systemd", "user", "myairouter.service"))
		}
	}
	fmt.Println("myairouter uninstalled: auto-start removed. Daemon keeps running until 'myairouter stop'.")
}
