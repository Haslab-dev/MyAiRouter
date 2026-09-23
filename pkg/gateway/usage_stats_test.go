package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"myAiRouter/pkg/db"
)

// seedUsage inserts usage rows at controlled offsets from now.
func seedUsage(t *testing.T, offsets []time.Duration) {
	t.Helper()
	for i, off := range offsets {
		ts := time.Now().UTC().Add(-off).Format(time.RFC3339)
		_, err := db.DB.Exec(`INSERT INTO usageHistory (timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cachedTokens, cost, status, tokens, meta)
			VALUES (?, 'qa-provider', 'qa-model', 'qa-conn', '', '/v1/chat/completions', 100, 50, 0, 0.01, 'success', '{}', '{}')`,
			ts, fmt.Sprintf("row-%s-%d", t.Name(), i))
		if err != nil {
			t.Fatalf("seed row: %v", err)
		}
	}
}

// TestUsageStatsPeriods hits /api/usage/stats with each period and verifies
// the request count reflects the period filter — not all-time. Regression for
// the Overview cards bug: every period showed all-time numbers.
func TestUsageStatsPeriods(t *testing.T) {
	server := newAuthTestServer(t)
	defer server.Close()

	// old = 40 days ago, mid = 10 days ago, today = now.
	seedUsage(t, []time.Duration{40 * 24 * time.Hour, 10 * 24 * time.Hour, 0})

	cases := []struct {
		period   string
		wantRows int
	}{
		{"", 1},   // Frontend default = Today
		{"today", 1},
		{"7d", 1},
		{"30d", 2},
		{"all", 3},
	}

	for _, tc := range cases {
		path := "/api/usage/stats?provider=&period=" + tc.period
		resp := doJSON(t, server, http.MethodGet, path, nil, nil)
		var stats db.UsageStats
		if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
			t.Fatalf("period %q: decode: %v", tc.period, err)
		}
		resp.Body.Close()
		if stats.TotalRequests != tc.wantRows {
			t.Errorf("period %q: requests = %d, want %d", tc.period, stats.TotalRequests, tc.wantRows)
		}
	}
}

// TestUsageChartsPeriods guards the same bug on the chart endpoint.
func TestUsageChartsPeriods(t *testing.T) {
	server := newAuthTestServer(t)
	defer server.Close()

	seedUsage(t, []time.Duration{40 * 24 * time.Hour, 10 * 24 * time.Hour, 0})

	for _, period := range []string{"", "7d", "30d"} {
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/api/usage/charts?provider=&period="+period, nil)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("period %q: %v", period, err)
		}
		var points []map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&points); err != nil {
			t.Fatalf("period %q: decode: %v", period, err)
		}
		resp.Body.Close()
		if len(points) == 0 {
			t.Errorf("period %q: chart returned no points", period)
		}
	}
}

var _ = httptest.NewServer // keep import if helpers change
