//go:build windows

package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// SystemMetrics holds resource usage info for the sidebar footer.
type SystemMetrics struct {
	Storage struct {
		Used      float64 `json:"used"`
		UsedBytes uint64  `json:"used_bytes"`
		Total     uint64  `json:"total"`
		Free      uint64  `json:"free"`
	} `json:"storage"`
	Memory struct {
		Used      float64 `json:"used"`
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

	// CPU usage sampling state (delta between collectMetrics calls)
	cpuMu           sync.Mutex
	cpuLastIdle     uint64
	cpuLastKernel   uint64
	cpuLastUser     uint64
	cpuHasLastSample bool
)

// ---------- Win32 bindings (stdlib syscall, no new deps) ----------

var (
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procGlobalMemory  = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetDiskSpace  = kernel32.NewProc("GetDiskFreeSpaceExW")
	procGetLogicalDrv = kernel32.NewProc("GetLogicalDrives")
	ntdll             = syscall.NewLazyDLL("ntdll.dll")
	procNtQuerySysInfo = ntdll.NewProc("NtQuerySystemInformation")
)

const (
	systemProcessorPerformanceInformation = 8 // SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION
)

// memoryStatusEx mirrors MEMORYSTATUSEX (dwLength must be set before the call).
type memoryStatusEx struct {
	dwLength                uint32
	dwMemoryLoad            uint32
	ullTotalPhys            uint64
	ullAvailPhys            uint64
	ullTotalPageFile        uint64
	ullAvailPageFile        uint64
	ullTotalVirtual         uint64
	ullAvailVirtual         uint64
	ullAvailExtendedVirtual uint64
}

// processorPerformanceInfo mirrors SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION.
type processorPerformanceInfo struct {
	IdleTime   int64
	KernelTime int64
	UserTime   int64
	// Reserved fields follow on 64-bit; we only need the first three.
	Reserved1 [2]int64
}

func winStorage() (m struct {
	Used      float64 `json:"used"`
	UsedBytes uint64  `json:"used_bytes"`
	Total     uint64  `json:"total"`
	Free      uint64  `json:"free"`
}) {
	drives, _, _ := procGetLogicalDrv.Call()
	if drives == 0 {
		return
	}
	// Sum fixed local drives (bit 0 = A:, bit 2 = C:, ...).
	for i := 0; i < 26; i++ {
		if drives&(1<<uint(i)) == 0 {
			continue
		}
		root := string(rune('A'+i)) + `:\`
		// Skip removable/network noise by checking the drive exists as a dir.
		if fi, err := os.Stat(root); err != nil || !fi.IsDir() {
			continue
		}
		rootPtr, err := syscall.UTF16PtrFromString(root)
		if err != nil {
			continue
		}
		var (
			freeCaller uint64
			totalBytes uint64
			totalFree  uint64
		)
		r1, _, _ := procGetDiskSpace.Call(
			uintptr(unsafe.Pointer(rootPtr)),
			uintptr(unsafe.Pointer(&freeCaller)),
			uintptr(unsafe.Pointer(&totalBytes)),
			uintptr(unsafe.Pointer(&totalFree)),
		)
		if r1 == 0 {
			continue
		}
		m.Total += totalBytes
		m.Free += totalFree
	}
	m.UsedBytes = m.Total - m.Free
	if m.Total > 0 {
		m.Used = float64(m.UsedBytes) / float64(m.Total) * 100.0
	}
	return
}

func winMemory() (m struct {
	Used      float64 `json:"used"`
	UsedBytes uint64  `json:"used_bytes"`
	Total     uint64  `json:"total"`
	Free      uint64  `json:"free"`
}) {
	var ms memoryStatusEx
	ms.dwLength = uint32(unsafe.Sizeof(ms))
	r1, _, _ := procGlobalMemory.Call(uintptr(unsafe.Pointer(&ms)))
	if r1 == 0 {
		return
	}
	m.Total = ms.ullTotalPhys
	m.Free = ms.ullAvailPhys
	m.UsedBytes = m.Total - m.Free
	if m.Total > 0 {
		m.Used = float64(m.UsedBytes) / float64(m.Total) * 100.0
	}
	return
}

// winCPUSample returns idle/kernel/user times summed across all logical CPUs.
// Times are 100ns units since boot. The buffer carries 4 extra slots because
// NtQuerySystemInformation needs headroom beyond the exact struct count.
func winCPUSample() (idle, kernel, user uint64, ok bool) {
	count := runtime.NumCPU()
	buf := make([]processorPerformanceInfo, count+4)
	r1, _, _ := procNtQuerySysInfo.Call(
		uintptr(systemProcessorPerformanceInformation),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)*int(unsafe.Sizeof(processorPerformanceInfo{}))),
		0,
	)
	if r1 != 0 {
		return 0, 0, 0, false
	}
	for i := 0; i < count; i++ {
		idle += uint64(buf[i].IdleTime)
		kernel += uint64(buf[i].KernelTime) // kernel time includes idle
		user += uint64(buf[i].UserTime)
	}
	return idle, kernel, user, true
}

// winCPUUsage computes CPU usage as the delta between the last two samples.
// First call returns 0 (no baseline yet) — the 30s collector fills it in quickly.
func winCPUUsage() float64 {
	cpuMu.Lock()
	defer cpuMu.Unlock()

	idle, kernel, user, ok := winCPUSample()
	if !ok {
		return 0
	}
	if !cpuHasLastSample {
		cpuLastIdle, cpuLastKernel, cpuLastUser = idle, kernel, user
		cpuHasLastSample = true
		return 0
	}

	dKernel := kernel - cpuLastKernel // includes idle time
	dUser := user - cpuLastUser
	dIdle := idle - cpuLastIdle
	cpuLastIdle, cpuLastKernel, cpuLastUser = idle, kernel, user

	totalDelta := (dKernel - dIdle) + dIdle + dUser
	if totalDelta == 0 {
		return 0
	}
	usage := float64(totalDelta-dIdle) / float64(totalDelta) * 100.0
	if usage < 0 {
		usage = 0
	} else if usage > 100 {
		usage = 100
	}
	return usage
}

func collectStorage() (m struct {
	Used      float64 `json:"used"`
	UsedBytes uint64  `json:"used_bytes"`
	Total     uint64  `json:"total"`
	Free      uint64  `json:"free"`
}) {
	return winStorage()
}

func collectMemory() (m struct {
	Used      float64 `json:"used"`
	UsedBytes uint64  `json:"used_bytes"`
	Total     uint64  `json:"total"`
	Free      uint64  `json:"free"`
}) {
	return winMemory()
}

func collectCPU() (m struct {
	Usage float64 `json:"usage"`
	Count int     `json:"count"`
}) {
	m.Count = runtime.NumCPU()
	m.Usage = winCPUUsage()
	return
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
