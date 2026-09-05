package health

import (
	"testing"
	"time"
)

func TestRecordFailureGrowsCooldown(t *testing.T) {
	tr := &Tracker{states: make(map[string]*connState)}

	tr.RecordFailure("conn-1")
	if !tr.InCooldown("conn-1") {
		t.Fatal("connection should be in cooldown after first failure")
	}
	first := tr.states["conn-1"].cooldownUntil

	tr.RecordFailure("conn-1")
	second := tr.states["conn-1"].cooldownUntil

	if !second.After(first) {
		t.Fatalf("cooldown should grow after consecutive failures: first=%v second=%v", first, second)
	}
	if got := tr.states["conn-1"].consecutiveFailures; got != 2 {
		t.Fatalf("consecutiveFailures = %d, want 2", got)
	}
}

func TestCooldownCapsAtMax(t *testing.T) {
	tr := &Tracker{states: make(map[string]*connState)}
	for i := 0; i < 10; i++ {
		tr.RecordFailure("conn-1")
	}
	left := time.Until(tr.states["conn-1"].cooldownUntil)
	if left > maxCooldown+time.Second {
		t.Fatalf("cooldown %v exceeds cap %v", left, maxCooldown)
	}
}

func TestRecordSuccessResetsFailureStreak(t *testing.T) {
	tr := &Tracker{states: make(map[string]*connState)}

	tr.RecordFailure("conn-1")
	tr.RecordFailure("conn-1")
	if !tr.InCooldown("conn-1") {
		t.Fatal("expected cooldown after failures")
	}

	tr.RecordSuccess("conn-1", 120, 40)
	if tr.InCooldown("conn-1") {
		t.Fatal("success should clear cooldown")
	}
	if tr.states["conn-1"].consecutiveFailures != 0 {
		t.Fatalf("success should reset failure streak, got %d", tr.states["conn-1"].consecutiveFailures)
	}
	if tr.LatencyMs("conn-1") != 120 {
		t.Fatalf("first latency sample = %v, want 120", tr.LatencyMs("conn-1"))
	}

	// EWMA should move toward the newest sample
	tr.RecordSuccess("conn-1", 300, 40)
	want := 120*(1-latencyEWMAAlpha) + 300*latencyEWMAAlpha
	if diff := tr.LatencyMs("conn-1") - want; diff < -0.01 || diff > 0.01 {
		t.Fatalf("EWMA = %v, want %v", tr.LatencyMs("conn-1"), want)
	}
}

func TestUnknownConnection(t *testing.T) {
	tr := &Tracker{states: make(map[string]*connState)}
	if tr.InCooldown("unknown") {
		t.Fatal("unknown connection must not be in cooldown")
	}
	if tr.LatencyMs("unknown") != -1 {
		t.Fatal("unknown connection must report no latency sample")
	}
}

func TestSnapshotOrdering(t *testing.T) {
	tr := &Tracker{states: make(map[string]*connState)}
	tr.RecordSuccess("fast", 50, 10)
	tr.RecordSuccess("slow", 900, 100)
	tr.RecordFailure("sick")

	snap := tr.Snapshot()
	if len(snap) != 3 {
		t.Fatalf("snapshot len = %d, want 3", len(snap))
	}
	if snap[0].ConnectionID != "fast" {
		t.Fatalf("fastest healthy connection should be first, got %s", snap[0].ConnectionID)
	}
	for _, s := range snap {
		if s.ConnectionID == "sick" && s.Healthy {
			t.Fatal("connection in cooldown must not report healthy")
		}
	}
}
