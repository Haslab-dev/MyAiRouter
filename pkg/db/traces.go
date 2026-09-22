package db

import (
	"database/sql"
	"encoding/json"
	"strings"
	"sync/atomic"
	"time"
)

// ─── New flat traces table ────────────────────────────────────────────────────

type TracePipelineStep struct {
	Name       string `json:"name"`
	Status     string `json:"status"` // "success", "skipped", "failed"
	Details    string `json:"details"`
	DurationMs int64  `json:"durationMs,omitempty"`
}

type AttemptDetail struct {
	Index        int    `json:"index"`
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	ConnectionID string `json:"connectionId"`
	Status       string `json:"status"` // "success", "failed", "skipped", "winner", "cancelled"
	ResponseCode int    `json:"responseCode"`
	DurationMs   int64  `json:"durationMs"`
	Error        string `json:"error,omitempty"`
}

type RequestMeta struct {
	System                string `json:"system,omitempty"`
	User                  string `json:"user,omitempty"`
	Messages              int    `json:"messages"`
	Chars                 int    `json:"chars"`
	Tokens                int    `json:"tokens"`
	Modified              bool   `json:"modified,omitempty"`
	CompressionApplied    bool   `json:"compressionApplied,omitempty"`
	OriginalTokens        int    `json:"originalTokens,omitempty"`
	PreparedTokens        int    `json:"preparedTokens,omitempty"`
	CompressedTokens      int    `json:"compressedTokens,omitempty"`
	ProtectedPrefixTokens int    `json:"protectedPrefixTokens,omitempty"`
	ProtectedSuffixTokens int    `json:"protectedSuffixTokens,omitempty"`
	Strategy              string `json:"strategy,omitempty"`
}

type ResponseMeta struct {
	Preview      string `json:"preview"`
	FinishReason string `json:"finishReason"`
}

type FlatTrace struct {
	ID             string              `json:"id"`
	Timestamp      string              `json:"timestamp"`
	Status         string              `json:"status"`
	Provider       string              `json:"provider"`
	Model          string              `json:"model"`
	Route          string              `json:"route"`
	Node           string              `json:"node"`
	RouteNodes     []string            `json:"routeNodes"`
	Attempt        int                 `json:"attempt"`
	TotalAttempts  int                 `json:"totalAttempts"`
	LatencyMs      int64               `json:"latencyMs"`
	TtfbMs         int64               `json:"ttfbMs"`
	InputTokens    int                 `json:"inputTokens"`
	OutputTokens   int                 `json:"outputTokens"`
	CachedTokens   int                 `json:"cachedTokens"`
	CachedRatio    float64             `json:"cachedRatio"`
	Compression    int                 `json:"compression"`
	Cache          string              `json:"cache"`
	Cost           float64             `json:"cost"`
	IsStream       bool                `json:"isStream"`
	RetryCount     int                 `json:"retryCount"`
	FallbackCount  int                 `json:"fallbackCount"`
	TargetAttempts []AttemptDetail     `json:"targetAttempts"`
	Pipeline       []TracePipelineStep `json:"pipeline"`
	RequestMeta    RequestMeta         `json:"requestMeta"`
	ResponseMeta   ResponseMeta        `json:"responseMeta"`
	ErrorCode      int                 `json:"errorCode,omitempty"`
	ErrorMessage   string              `json:"errorMessage,omitempty"`
	Request        string              `json:"request,omitempty"`
	Response       string              `json:"response,omitempty"`
}

func SaveTrace(t *FlatTrace) error {
	if t.Timestamp == "" {
		t.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	nodesJSON := "[]"
	if len(t.RouteNodes) > 0 {
		b, _ := json.Marshal(t.RouteNodes)
		nodesJSON = string(b)
	}
	attemptsJSON := "[]"
	if len(t.TargetAttempts) > 0 {
		b, _ := json.Marshal(t.TargetAttempts)
		attemptsJSON = string(b)
	}
	pipelineJSON := "[]"
	if len(t.Pipeline) > 0 {
		b, _ := json.Marshal(t.Pipeline)
		pipelineJSON = string(b)
	}
	reqMetaJSON, _ := json.Marshal(t.RequestMeta)
	respMetaJSON, _ := json.Marshal(t.ResponseMeta)

	isStreamInt := 0
	if t.IsStream {
		isStreamInt = 1
	}

	totalAttempts := t.TotalAttempts
	if totalAttempts < 1 {
		totalAttempts = 1
	}

	_, err := DB.Exec(`
		INSERT INTO traces
			(id, timestamp, status, provider, model, route, node, routeNodes,
			 attempt, totalAttempts, latencyMs, ttfbMs, inputTokens, outputTokens, cachedTokens,
			 compression, cache, cost, isStream, retryCount, fallbackCount,
			 targetAttempts, pipeline, requestMeta, responseMeta, errorCode, errorMessage, request, response)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET
			status=excluded.status, latencyMs=excluded.latencyMs,
			inputTokens=excluded.inputTokens, outputTokens=excluded.outputTokens,
			cachedTokens=excluded.cachedTokens, cost=excluded.cost,
			errorCode=excluded.errorCode, errorMessage=excluded.errorMessage,
			request=excluded.request, response=excluded.response`,
		t.ID, t.Timestamp, t.Status, t.Provider, t.Model,
		t.Route, t.Node, nodesJSON,
		t.Attempt, totalAttempts, t.LatencyMs, t.TtfbMs,
		t.InputTokens, t.OutputTokens, t.CachedTokens,
		t.Compression, t.Cache, t.Cost, isStreamInt,
		t.RetryCount, t.FallbackCount,
		attemptsJSON, pipelineJSON, string(reqMetaJSON), string(respMetaJSON),
		t.ErrorCode, t.ErrorMessage,
		t.Request, t.Response,
	)
	if err == nil {
		maybePruneTraces()
	}
	return err
}

func scanFlatTrace(rows interface {
	Scan(...any) error
}, includeText bool) (*FlatTrace, error) {
	var t FlatTrace
	var nodesJSON, attemptsJSON, pipelineJSON, reqMetaStr, respMetaStr sql.NullString
	var errorCode sql.NullInt64
	var errorMessage sql.NullString
	var isStreamInt int

	scanInto := func(req, resp sql.NullString) error {
		return rows.Scan(
			&t.ID, &t.Timestamp, &t.Status, &t.Provider, &t.Model,
			&t.Route, &t.Node, &nodesJSON,
			&t.Attempt, &t.TotalAttempts, &t.LatencyMs, &t.TtfbMs,
			&t.InputTokens, &t.OutputTokens, &t.CachedTokens,
			&t.Compression, &t.Cache, &t.Cost, &isStreamInt,
			&t.RetryCount, &t.FallbackCount,
			&attemptsJSON, &pipelineJSON, &reqMetaStr, &respMetaStr,
			&errorCode, &errorMessage,
			&req, &resp,
		)
	}

	if includeText {
		var req, resp sql.NullString
		if err := scanInto(req, resp); err != nil {
			return nil, err
		}
		t.Request = req.String
		t.Response = resp.String
	} else {
		var req, resp sql.NullString
		if err := scanInto(req, resp); err != nil {
			return nil, err
		}
	}

	t.ErrorCode = int(errorCode.Int64)
	t.ErrorMessage = errorMessage.String
	t.IsStream = isStreamInt == 1
	if t.InputTokens > 0 {
		t.CachedRatio = float64(t.CachedTokens) / float64(t.InputTokens)
	}

	if nodesJSON.Valid && nodesJSON.String != "" && nodesJSON.String != "[]" {
		_ = json.Unmarshal([]byte(nodesJSON.String), &t.RouteNodes)
	}
	if t.RouteNodes == nil {
		t.RouteNodes = []string{}
	}

	if attemptsJSON.Valid && attemptsJSON.String != "" && attemptsJSON.String != "[]" {
		_ = json.Unmarshal([]byte(attemptsJSON.String), &t.TargetAttempts)
	}
	if t.TargetAttempts == nil {
		t.TargetAttempts = []AttemptDetail{}
	}

	if pipelineJSON.Valid && pipelineJSON.String != "" && pipelineJSON.String != "[]" {
		_ = json.Unmarshal([]byte(pipelineJSON.String), &t.Pipeline)
	}
	if t.Pipeline == nil {
		t.Pipeline = []TracePipelineStep{}
	}

	if reqMetaStr.Valid && reqMetaStr.String != "" {
		_ = json.Unmarshal([]byte(reqMetaStr.String), &t.RequestMeta)
	}
	if respMetaStr.Valid && respMetaStr.String != "" {
		_ = json.Unmarshal([]byte(respMetaStr.String), &t.ResponseMeta)
	}

	return &t, nil
}

const selectCols = `id, timestamp, status, provider, model, route, node, routeNodes,
	attempt, totalAttempts, latencyMs, ttfbMs, inputTokens, outputTokens, cachedTokens,
	compression, cache, cost, isStream, retryCount, fallbackCount,
	targetAttempts, pipeline, requestMeta, responseMeta, errorCode, errorMessage, request, response`

func GetFlatTracesPaginated(page, perPage int) ([]*FlatTrace, int, error) {
	var total int
	if err := DB.QueryRow(`SELECT COUNT(*) FROM traces`).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * perPage
	if offset < 0 {
		offset = 0
	}

	rows, err := DB.Query(
		`SELECT `+selectCols+` FROM traces ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
		perPage, offset,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []*FlatTrace
	for rows.Next() {
		t, err := scanFlatTrace(rows, false)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, t)
	}
	return out, total, nil
}

func GetFlatTraceByID(id string) (*FlatTrace, error) {
	row := DB.QueryRow(
		`SELECT `+selectCols+` FROM traces WHERE id = ?`, id,
	)
	t, err := scanFlatTrace(row, true)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return t, err
}

func ResetFlatTraces() error {
	_, err := DB.Exec(`DELETE FROM traces`)
	return err
}

// traceSaveCount throttles pruning: the table size is only checked every
// N saves instead of on every insert.
var traceSaveCount atomic.Int64

// PruneFlatTraces keeps only the newest `max` traces and deletes the rest.
// Usage/metric data (usageHistory) is a separate table and is never touched.
func PruneFlatTraces(max int) error {
	if max <= 0 {
		max = 500
	}
	_, err := DB.Exec(
		`DELETE FROM traces WHERE id NOT IN (SELECT id FROM traces ORDER BY timestamp DESC LIMIT ?)`,
		max,
	)
	return err
}

// maybePruneTraces enforces the rolling cap every 25 saves.
func maybePruneTraces() {
	if traceSaveCount.Add(1)%25 != 0 {
		return
	}
	_ = PruneFlatTraces(maxRetainedTraces())
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func truncateStr(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) > max {
		return s[:max] + "...[TRUNCATED]"
	}
	return s
}
