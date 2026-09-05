package middleware

import (
	"net/http"

	"myAiRouter/pkg/db"
)

// ErrorClass determines how the fallback engine reacts to an upstream failure.
type ErrorClass int

const (
	// ErrRetryable: transient upstream problem (429, 408, 5xx, network error,
	// attempt timeout) — advance to the next target.
	ErrRetryable ErrorClass = iota
	// ErrAccountFailover: the account/credentials are the problem (401, 403).
	// The engine may try the remaining connections of the SAME provider but
	// must not silently switch the client to a different provider's model.
	ErrAccountFailover
	// ErrTerminal: the request itself is rejected (400, 404, 413, 422, ...).
	// Retrying elsewhere would burn money for the same outcome — stop and
	// return the upstream error to the client unchanged.
	ErrTerminal
)

// ClassifyStatus maps an upstream HTTP status to a fallback decision.
// A code of 0 means a transport-level failure (connection refused, TLS
// handshake, attempt timeout) — the target was never reached.
func ClassifyStatus(code int) ErrorClass {
	switch {
	case code == 0:
		return ErrRetryable
	case code == http.StatusRequestTimeout, code == http.StatusTooManyRequests:
		return ErrRetryable
	case code == http.StatusUnauthorized, code == http.StatusForbidden:
		return ErrAccountFailover
	case code >= 500:
		return ErrRetryable
	default:
		return ErrTerminal
	}
}

// ClassifyStatusWithPolicy applies the combo's fallbackPolicy on top of the
// default classification:
//   - auto (default): the classification above
//   - aggressive: legacy behavior — fall back on any HTTP >= 400
//   - conservative: only 408/429/5xx and network errors fall back
func ClassifyStatusWithPolicy(code int, fallbackPolicy string) ErrorClass {
	switch fallbackPolicy {
	case db.FallbackPolicyAggressive:
		return ErrRetryable
	case db.FallbackPolicyConservative:
		switch {
		case code == 0, code == http.StatusRequestTimeout, code == http.StatusTooManyRequests, code >= 500:
			return ErrRetryable
		default:
			return ErrTerminal
		}
	default:
		return ClassifyStatus(code)
	}
}
