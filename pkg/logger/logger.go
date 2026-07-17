package logger

import (
	"fmt"
	"sync"
	"time"
)

var (
	mu   sync.RWMutex
	logs []string
	max  = 200
)

func Log(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	now := time.Now().Format("2006-01-02 15:04:05")
	line := fmt.Sprintf("[%s] %s", now, msg)

	// Print to normal standard output
	fmt.Println(line)

	mu.Lock()
	defer mu.Unlock()

	logs = append(logs, line)
	if len(logs) > max {
		logs = logs[1:]
	}
}

func GetLogs() []string {
	mu.RLock()
	defer mu.RUnlock()

	res := make([]string, len(logs))
	copy(res, logs)
	return res
}
