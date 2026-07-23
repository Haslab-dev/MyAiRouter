package db

import (
	"sync"
	"time"
)

var (
	reqTimestamps []time.Time
	reqMutex      sync.Mutex
)

// RecordRequestMetric records a request timestamp for rolling RPS calculation
func RecordRequestMetric() {
	now := time.Now()
	reqMutex.Lock()
	defer reqMutex.Unlock()

	reqTimestamps = append(reqTimestamps, now)
	cutoff := now.Add(-10 * time.Second)

	idx := 0
	for idx < len(reqTimestamps) && reqTimestamps[idx].Before(cutoff) {
		idx++
	}
	if idx > 0 {
		reqTimestamps = reqTimestamps[idx:]
	}
}

// GetCurrentRPS calculates current requests per second over the last 10 seconds
func GetCurrentRPS() float64 {
	now := time.Now()
	reqMutex.Lock()
	defer reqMutex.Unlock()

	cutoff := now.Add(-10 * time.Second)
	count := 0
	for _, t := range reqTimestamps {
		if t.After(cutoff) {
			count++
		}
	}
	if count == 0 {
		return 0.0
	}
	return float64(count) / 10.0
}
