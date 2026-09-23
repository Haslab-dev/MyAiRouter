package main

import (
	"os"
	"os/signal"
	"syscall"
)

// notifySig registers the shutdown signals on sigCh. Works on Windows and
// unix: os.Interrupt is Ctrl+C / console close, syscall.SIGTERM is what
// service managers and `kill` send.
func notifySig(sigCh chan os.Signal) {
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
}
