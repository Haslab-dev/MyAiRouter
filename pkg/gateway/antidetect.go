package gateway

import (
	"net/http"

	"myAiRouter/pkg/db"
)

// Re-exports the provider anti-detect layer for the test-connection path.
// See internal/gateway/providers/antidetect.go for rationale.

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
// when the connection routes through a proxy.
func ApplyAntiDetect(req *http.Request, conn *db.ProviderConnection) {
	if !hasProxyRoute(conn) {
		return
	}

	for _, h := range forwardHeaders {
		req.Header.Del(h)
	}
	for _, h := range identifyingHeaders {
		req.Header.Del(h)
	}

	if ua := req.Header.Get("User-Agent"); ua == "" || containsGoAgent(ua) {
		req.Header.Set("User-Agent", "OpenAI/JS 4.77.0")
	}

	req.Header.Del("Origin")
	req.Header.Del("Referer")
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
	return contains(ua, "Go-http-client") || contains(ua, "Go/") || contains(ua, "myairouter") || contains(ua, "myairouter")
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && indexOf(s, substr) >= 0
}

func indexOf(s, substr string) int {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
