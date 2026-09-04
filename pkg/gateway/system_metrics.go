package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

// SystemMetrics holds resource usage info for the sidebar footer.
type SystemMetrics struct {
	Storage struct {
		Used      float64 `json:"used"` // percentage
		UsedBytes uint64  `json:"used_bytes"`
		Total     uint64  `json:"total"`
		Free      uint64  `json:"free"`
	} `json:"storage"`
	Memory struct {
		Used      float64 `json:"used"` // percentage
		UsedBytes uint64  `json:"used_bytes"`
		Total     uint64  `json:"total"`
		Free      uint64  `json:"free"`
	} `json:"memory"`
	CPU struct {
		Usage float64 `json:"usage"`
		Count int     `json:"count"`
	} `json:"cpu"`
	Health struct {
		Status string `json:"status"`
		Score  int    `json:"score"`
	} `json:"health"`
	Timestamp string `json:"timestamp"`
}

var (
	metricsCache   SystemMetrics
	metricsMutex   sync.RWMutex
	metricsTimer   *time.Ticker
	metricsStop    chan struct{}
	metricsStarted bool

	lastLinuxCPUTotal uint64
	lastLinuxCPUIdle  uint64
	linuxCPUMu        sync.Mutex
)

func collectStorage() (m struct {
	Used      float64 `json:"used"`
	UsedBytes uint64  `json:"used_bytes"`
	Total     uint64  `json:"total"`
	Free      uint64  `json:"free"`
}) {
	var stat unix.Statfs_t
	path := "/"
	if runtime.GOOS == "darwin" {
		if _, err := os.Stat("/System/Volumes/Data"); err == nil {
			path = "/System/Volumes/Data"
		}
	}
	if err := unix.Statfs(path, &stat); err != nil {
		if err := unix.Statfs("/", &stat); err != nil {
			return
		}
	}

	bsize := uint64(stat.Bsize)
	if bsize == 0 {
		bsize = 4096
	}
	total := uint64(stat.Blocks) * bsize
	avail := uint64(stat.Bavail) * bsize
	if avail > total {
		avail = total
	}
	used := total - avail

	m.Total = total
	m.Free = avail
	m.UsedBytes = used
	if total > 0 {
		m.Used = float64(used) / float64(total) * 100.0
	}
	return
}

func collectMemory() (m struct {
	Used      float64 `json:"used"`
	UsedBytes uint64  `json:"used_bytes"`
	Total     uint64  `json:"total"`
	Free      uint64  `json:"free"`
}) {
	if runtime.GOOS == "darwin" {
		return collectMemoryDarwin()
	}
	return collectMemoryLinux()
}

func collectMemoryLinux() (m struct {
	Used      float64 `json:"used"`
	UsedBytes uint64  `json:"used_bytes"`
	Total     uint64  `json:"total"`
	Free      uint64  `json:"free"`
}) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return
	}
	mem := make(map[string]uint64)
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		val, err := parseUint(fields[1])
		if err == nil {
			mem[key] = val * 1024
		}
	}
	total := mem["MemTotal"]
	var avail uint64
	if v, ok := mem["MemAvailable"]; ok && v > 0 {
		avail = v
	} else {
		// Fallback for older Linux kernels
		avail = mem["MemFree"] + mem["Buffers"] + mem["Cached"] + mem["SReclaimable"]
	}
	if avail > total {
		avail = total
	}
	used := total - avail

	m.Total = total
	m.Free = avail
	m.UsedBytes = used
	if total > 0 {
		m.Used = float64(used) / float64(total) * 100.0
	}
	return
}

func collectMemoryDarwin() (m struct {
	Used      float64 `json:"used"`
	UsedBytes uint64  `json:"used_bytes"`
	Total     uint64  `json:"total"`
	Free      uint64  `json:"free"`
}) {
	var total uint64
	out, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
	if err == nil {
		if v, e := parseUint(strings.TrimSpace(string(out))); e == nil {
			total = v
		}
	}
	if total == 0 {
		total = 8 * 1024 * 1024 * 1024
	}

	vmOut, err := exec.Command("vm_stat").Output()
	if err != nil {
		return
	}
	var pageSize uint64 = 4096
	stats := make(map[string]uint64)
	for _, line := range strings.Split(string(vmOut), "\n") {
		if idx := strings.Index(line, "page size of "); idx >= 0 {
			rest := line[idx+len("page size of "):]
			fields := strings.Fields(rest)
			if len(fields) > 0 {
				if v, e := parseUint(fields[0]); e == nil {
					pageSize = v
				}
			}
			continue
		}
		parts := strings.Split(line, ":")
		if len(parts) < 2 {
			continue
		}
		k := strings.Trim(strings.TrimSpace(parts[0]), "\"")
		vStr := strings.TrimSuffix(strings.TrimSpace(parts[1]), ".")
		if v, e := parseUint(vStr); e == nil {
			stats[k] = v
		}
	}

	// In macOS, free memory alone misses inactive, speculative and purgeable memory.
	free := stats["Pages free"] * pageSize
	inactive := stats["Pages inactive"] * pageSize
	speculative := stats["Pages speculative"] * pageSize
	purgeable := stats["Pages purgeable"] * pageSize
	avail := free + inactive + speculative + purgeable
	if avail > total {
		avail = total
	}
	used := total - avail

	m.Total = total
	m.Free = avail
	m.UsedBytes = used
	if total > 0 {
		m.Used = float64(used) / float64(total) * 100.0
	}
	return
}

func collectCPU() (m struct {
	Usage float64 `json:"usage"`
	Count int     `json:"count"`
}) {
	m.Count = runtime.NumCPU()
	if runtime.GOOS == "darwin" {
		m.Usage = cpuUsageDarwin()
	} else if runtime.GOOS == "linux" {
		m.Usage = cpuUsageLinux()
	}
	return
}

func cpuUsageDarwin() float64 {
	out, err := exec.Command("top", "-l", "1", "-n", "0").Output()
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "CPU usage:") {
			parts := strings.Split(line, ",")
			for _, part := range parts {
				if strings.Contains(part, "idle") {
					fields := strings.Fields(part)
					if len(fields) >= 2 {
						idleStr := strings.TrimSuffix(fields[0], "%")
						var idleVal float64
						if _, e := fmt.Sscanf(idleStr, "%f", &idleVal); e == nil {
							usage := 100.0 - idleVal
							if usage < 0 {
								usage = 0
							} else if usage > 100 {
								usage = 100
							}
							return usage
						}
					}
				}
			}
		}
	}
	return 0
}

func cpuUsageLinux() float64 {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0
	}
	var total, idle uint64
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "cpu ") {
			fields := strings.Fields(line)
			if len(fields) < 5 {
				continue
			}
			for i := 1; i < len(fields) && i < 8; i++ {
				val, e := parseUint(fields[i])
				if e != nil {
					continue
				}
				total += val
				if i == 4 {
					idle = val
				}
			}
			break
		}
	}

	linuxCPUMu.Lock()
	defer linuxCPUMu.Unlock()
	if lastLinuxCPUTotal == 0 {
		lastLinuxCPUTotal = total
		lastLinuxCPUIdle = idle
		return 0
	}
	deltaTotal := total - lastLinuxCPUTotal
	deltaIdle := idle - lastLinuxCPUIdle
	lastLinuxCPUTotal = total
	lastLinuxCPUIdle = idle

	if deltaTotal > 0 {
		usage := float64(deltaTotal-deltaIdle) / float64(deltaTotal) * 100.0
		if usage < 0 {
			usage = 0
		} else if usage > 100 {
			usage = 100
		}
		return usage
	}
	return 0
}

func computeHealth(storageUsed, memoryUsed, cpuUsage float64) (string, int) {
	score := 100
	if storageUsed > 90 {
		score -= 30
	} else if storageUsed > 80 {
		score -= 15
	}
	if memoryUsed > 90 {
		score -= 30
	} else if memoryUsed > 80 {
		score -= 15
	}
	if cpuUsage > 90 {
		score -= 20
	} else if cpuUsage > 80 {
		score -= 10
	}
	if score < 0 {
		score = 0
	}

	status := "healthy"
	switch {
	case score >= 80:
		status = "healthy"
	case score >= 50:
		status = "degraded"
	default:
		status = "critical"
	}
	return status, score
}

func parseUint(s string) (uint64, error) {
	var n uint64
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("invalid char")
		}
		n = n*10 + uint64(c-'0')
	}
	return n, nil
}

func collectMetrics() {
	var next SystemMetrics
	next.Storage = collectStorage()
	next.Memory = collectMemory()
	next.CPU = collectCPU()
	status, score := computeHealth(next.Storage.Used, next.Memory.Used, next.CPU.Usage)
	next.Health.Status = status
	next.Health.Score = score
	next.Timestamp = time.Now().UTC().Format(time.RFC3339)

	metricsMutex.Lock()
	metricsCache = next
	metricsMutex.Unlock()
}

func StartMetricsCollector(interval time.Duration) {
	if metricsStarted {
		return
	}
	metricsStarted = true
	metricsStop = make(chan struct{})
	metricsTimer = time.NewTicker(interval)

	// Perform an initial collection immediately
	go collectMetrics()

	go func() {
		for {
			select {
			case <-metricsTimer.C:
				collectMetrics()
			case <-metricsStop:
				metricsTimer.Stop()
				return
			}
		}
	}()
}

func StopMetricsCollector() {
	if !metricsStarted {
		return
	}
	metricsStarted = false
	if metricsStop != nil {
		close(metricsStop)
	}
}

func GetSystemMetrics() SystemMetrics {
	metricsMutex.RLock()
	metrics := metricsCache
	metricsMutex.RUnlock()

	// If empty on first request, collect synchronously
	if metrics.Timestamp == "" {
		collectMetrics()
		metricsMutex.RLock()
		metrics = metricsCache
		metricsMutex.RUnlock()
	}
	return metrics
}

func HandleSystemMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteErrorResponse(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	metrics := GetSystemMetrics()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	_ = json.NewEncoder(w).Encode(metrics)
}