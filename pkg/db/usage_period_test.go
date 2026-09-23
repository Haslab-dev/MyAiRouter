package db

import (
	"strings"
	"testing"
)

// TestBuildUsageWherePeriods pins the period→SQL mapping. Regression guard for
// the Overview bug where every period returned all-time totals because the
// frontend sends "" for Today and no clause matched an empty period.
func TestBuildUsageWherePeriods(t *testing.T) {
	cases := []struct {
		period      string
		wantClause  string
		wantNoDate  bool
	}{
		{"", "start of day", false},
		{"today", "-1 day", false},
		{"day", "-1 day", false},
		{"24h", "-1 day", false},
		{"yesterday", "start of day", false},
		{"7d", "-7 days", false},
		{"week", "-7 days", false},
		{"30d", "-30 days", false},
		{"month", "-30 days", false},
		{"all", "(none)", true},
	}

	for _, tc := range cases {
		where, _ := BuildUsageWhere("", tc.period, "", "")
		if tc.period == "" && !strings.Contains(where, "start of day") {
			t.Errorf("period %q: Today must filter from start of day, got %q", tc.period, where)
		}
		if tc.wantNoDate {
			if strings.Contains(where, "start of day") || strings.Contains(where, "-1 day") ||
				strings.Contains(where, "-7 days") || strings.Contains(where, "-30 days") {
				t.Errorf("period %q: all-time must not filter by date, got %q", tc.period, where)
			}
			continue
		}
		if tc.period != "" && !strings.Contains(where, tc.wantClause) {
			t.Errorf("period %q: want %q in %q", tc.period, tc.wantClause, where)
		}
	}

	// Every distinct period must produce a different filter from all-time.
	allWhere, _ := BuildUsageWhere("", "all", "", "")
	for _, p := range []string{"", "7d", "30d"} {
		w, _ := BuildUsageWhere("", p, "", "")
		if w == allWhere {
			t.Errorf("period %q returns the same WHERE as all-time (%q)", p, w)
		}
	}

	// Zero-padded RFC3339 timestamps must compare correctly against SQLite
	// datetime('now', ...) — this is why every clause wraps timestamp in
	// datetime(): raw string comparison against "YYYY-MM-DD HH:MM:SS" would
	// never match a "2026-09-20T15:21:26Z" value.
	where, _ := BuildUsageWhere("", "7d", "", "")
	if !strings.Contains(where, "datetime(timestamp)") {
		t.Fatalf("7d must normalize timestamp, got %q", where)
	}
}
