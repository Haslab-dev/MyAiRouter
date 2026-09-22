package providers

import (
	"net/http"

	"myAiRouter/pkg/db"
)

// Anti-detect layer.
//
// Providers fingerprint callers via forwarded/identifying headers that the
// Go http client and intermediate proxies inject. Scrubbing them before the
// request leaves the gateway makes proxied traffic indistinguishable from a
// first-party SDK call.

var forwardHeaders = []string{
	"X-Forwarded-For",
	"X-Forwarded-Host",
	"X-Forwarded-Proto",
	"X-Forwarded-Port",
	"X-Real-Ip",
	"X-Client-Ip",
	"X-Originating-Ip",
	"X-Remote-Ip",
	"X-Remote-Addr",
	"Forwarded",
	"Via",
	"CF-Connecting-Ip",
	"True-Client-Ip",
}

var identifyingHeaders = []string{
	"X-Requested-With",
	"X-Request-Id",
	"X-Correlation-Id",
	"Traceparent",
	"Tracestate",
}

// ApplyAntiDetect scrubs fingerprinting headers and sets a neutral User-Agent
// when the connection routes through a proxy. Callers must invoke it after
// setting all legitimate headers.
func ApplyAntiDetect(req *http.Request, conn *db.ProviderConnection) {
	// Only rewrite the fingerprint when a proxy route is in play; direct
	// connections keep their original identity.
	if !hasProxyRoute(conn) {
		return
	}

	for _, h := range forwardHeaders {
		req.Header.Del(h)
	}
	for _, h := range identifyingHeaders {
		req.Header.Del(h)
	}

	// Neutral, provider-SDK-like UA — no Go/http, no router name.
	if ua := req.Header.Get("User-Agent"); ua == "" || containsGoAgent(ua) {
		req.Header.Set("User-Agent", "OpenAI/JS 4.77.0")
	}

	// Strip the caller's origin; providers log it for abuse scoring.
	req.Header.Del("Origin")
	if ref := req.Header.Get("Referer"); ref != "" {
		req.Header.Del("Referer")
	}
}

func hasProxyRoute(conn *db.ProviderConnection) bool {
	if conn == nil {
		return false
	}
	route, err := db.ProxyRouteForConnection(conn)
	if err != nil || route == nil {
		return false
	}
	return route.IsEnabled && route.Host != "" && route.Port != 0
}

func containsGoAgent(ua string) bool {
	for _, marker := range []string{"Go-http-client", "Go/", "myairouter", "myairouter"} {
		if contains(ua, marker) {
			return true
		}
	}
	return false
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || indexOf(s, substr) >= 0)
}

func indexOf(s, substr string) int {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
