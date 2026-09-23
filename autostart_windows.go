//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

const taskName = "MyAiRouter Gateway"

// taskXML is the scheduled-task definition: run at user logon AND system
// boot (laptop 켜면 langsung jalan tanpa perlu dinyalakan manual), restart
// the process if it crashes (restart interval acts as the watchdog), and
// run hidden. Note: the schema element is a single <Arguments> (plural) —
// multiple <Argument> nodes are silently ignored by schtasks.
func taskXML(exePath string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
    <BootTrigger>
      <Enabled>true</Enabled>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Hidden>true</Hidden>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>%s</Command>
      <Arguments>start -d</Arguments>
    </Exec>
  </Actions>
</Task>`, exePath)
}

func runSchTasks(args ...string) error {
	return exec.Command("schtasks", args...).Run()
}

// installAutostart registers a boot-time scheduled task that (re)starts the
// daemon if it is not running — both auto-start on boot and a crash watchdog.
func installAutostart() {
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error resolving executable path: %v\n", err)
		os.Exit(1)
	}
	xmlPath := exe + ".task.xml"
	if err := os.WriteFile(xmlPath, []byte(taskXML(exe)), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Error writing task definition: %v\n", err)
		os.Exit(1)
	}
	defer os.Remove(xmlPath)
	if err := runSchTasks("/Create", "/F", "/TN", taskName, "/XML", xmlPath); err != nil {
		fmt.Fprintln(os.Stderr, "Error: failed to create scheduled task (try running as Administrator once).")
		os.Exit(1)
	}
	// Start it right away so the user doesn't need to reboot to activate.
	_ = runSchTasks("/Run", "/TN", taskName)
	fmt.Printf("myairouter installed: auto-start on boot + crash watchdog (task %q).\nRemove with: myairouter uninstall\n", taskName)
}

func uninstallAutostart() {
	if err := runSchTasks("/Delete", "/F", "/TN", taskName); err != nil {
		fmt.Println("myairouter: no auto-start task found (already uninstalled).")
		return
	}
	fmt.Println("myairouter uninstalled: auto-start removed. Daemon keeps running until 'myairouter stop'.")
}
