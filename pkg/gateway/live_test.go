package gateway

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The Overview animation is only useful if /api/live reflects reality. These
// tests pin the contract: a request shows up while it runs, carries its route,
// and becomes a terminal "ok"/"error" entry once it finishes.

func TestLiveActivityLifecycle(t *testing.T) {
	ResetLiveActivity()

	id := BeginActivity("req-1", "openai/gpt-x", "/v1/chat/completions")
	if id != "req-1" {
		t.Fatalf("BeginActivity returned %q", id)
	}

	summary, sessions := liveActivity.Snapshot(time.Time{})
	if summary["active"].(int) != 1 {
		t.Fatalf("active = %v, want 1", summary["active"])
	}
	if len(sessions) != 1 || sessions[0].Status != "running" {
		t.Fatalf("sessions = %+v, want 1 running", sessions)
	}

	ComboResolved(id, "openai/gpt-x", "MyCombo", "race", 2)
	AttemptStarted(id, "openai", "gpt-x", 1)

	summary, sessions = liveActivity.Snapshot(time.Time{})
	if sessions[0].Combo != "MyCombo" || sessions[0].Kind != "race" || sessions[0].Targets != 2 {
		t.Fatalf("session lost route info: %+v", sessions[0])
	}
	if summary["inflight"].(int) != 1 {
		t.Fatalf("inflight = %v, want 1", summary["inflight"])
	}

	AttemptFinished(id)
	FinishActivity(id, 200, true, 100, 42, 0)

	summary, sessions = liveActivity.Snapshot(time.Time{})
	if summary["active"].(int) != 0 {
		t.Fatalf("active after finish = %v, want 0", summary["active"])
	}
	if len(sessions) != 1 || sessions[0].Status != "ok" || !sessions[0].Finished {
		t.Fatalf("finished session = %+v", sessions)
	}
	if sessions[0].PromptTokens != 100 || sessions[0].Completion != 42 {
		t.Fatalf("tokens not recorded: %+v", sessions[0])
	}
}

func TestLiveActivityStalledShowsWaiting(t *testing.T) {
	ResetLiveActivity()

	id := BeginActivity("req-stall", "prov/m", "/v1/chat/completions")
	AttemptStarted(id, "prov", "m", 1)

	// Force lastOutput into the past so the session reads as stalled.
	liveActivity.mu.Lock()
	liveActivity.sessions[id].lastOutput = time.Now().Add(-time.Minute)
	liveActivity.mu.Unlock()

	_, sessions := liveActivity.Snapshot(time.Time{})
	if len(sessions) != 1 || sessions[0].Status != "waiting" {
		t.Fatalf("stalled session status = %+v, want waiting", sessions)
	}
}

func TestLiveActivityHandler(t *testing.T) {
	ResetLiveActivity()

	id := BeginActivity("req-http", "openai/gpt-x", "/v1/chat/completions")
	ComboResolved(id, "openai/gpt-x", "", "direct", 1)

	req := httptest.NewRequest(http.MethodGet, "/api/live", nil)
	rec := httptest.NewRecorder()
	handleLiveActivity(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("content-type = %q", ct)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["active"] != float64(1) {
		t.Fatalf("active = %v", body["active"])
	}
	sessions, ok := body["sessions"].([]any)
	if !ok || len(sessions) != 1 {
		t.Fatalf("sessions = %v", body["sessions"])
	}
	sess := sessions[0].(map[string]any)
	if sess["id"] != "req-http" || sess["model"] != "openai/gpt-x" {
		t.Fatalf("session = %v", sess)
	}
}

func TestLiveActivityReap(t *testing.T) {
	ResetLiveActivity()

	id := BeginActivity("req-old", "m", "/v1/chat/completions")
	FinishActivity(id, 200, true, 1, 1, 0)

	// Backdate the finish far beyond the grace window.
	liveActivity.mu.Lock()
	liveActivity.sessions[id].endedAt = time.Now().Add(-time.Minute)
	liveActivity.mu.Unlock()

	_, sessions := liveActivity.Snapshot(time.Time{})
	if len(sessions) != 0 {
		t.Fatalf("finished session should have been reaped, got %d", len(sessions))
	}
}
