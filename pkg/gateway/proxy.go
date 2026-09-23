package gateway

import (
	"net/http"
	"net/url"
	"sync"
	"time"

	"myAiRouter/pkg/db"
	"golang.org/x/net/proxy"
)

// ProxyManager keeps a pool of *http.Client instances, one per proxy route,
// so connections through a proxy reuse keep-alive transports instead of
// rebuilding the dialer on every request.
type ProxyManager struct {
	mu      sync.RWMutex
	clients map[string]*http.Client
}

var proxyManager = &ProxyManager{
	clients: make(map[string]*http.Client),
}

// ClientFor returns an *http.Client that routes through the proxy attached
// to the given connection. Falls back to the shared direct client when the
// connection has no proxy, the route is disabled, or the route is missing.
func ClientFor(conn *db.ProviderConnection) *http.Client {
	if conn == nil {
		return SharedHTTPClient
	}
	route, err := db.ProxyRouteForConnection(conn)
	if err != nil || route == nil || !route.IsEnabled || route.Host == "" || route.Port == 0 {
		return SharedHTTPClient
	}
	return proxyManager.clientFor(route)
}

func (pm *ProxyManager) clientFor(route *db.ProxyRoute) *http.Client {
	pm.mu.RLock()
	c, ok := pm.clients[route.ID]
	pm.mu.RUnlock()
	if ok {
		return c
	}

	pm.mu.Lock()
	defer pm.mu.Unlock()
	if c, ok := pm.clients[route.ID]; ok {
		return c
	}

	proxyURL := db.ProxyURL(route)
	var transport *http.Transport

	switch route.Scheme {
	case "socks5", "socks5h", "socks":
		if dialer, err := proxy.SOCKS5("tcp", proxyURL, nil, proxy.Direct); err == nil {
			transport = baseTransport()
			transport.Dial = dialer.Dial
		}
	default:
		if u, err := url.Parse(proxyURL); err == nil {
			transport = baseTransport()
			transport.Proxy = http.ProxyURL(u)
		}
	}

	if transport == nil {
		return SharedHTTPClient
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   120 * time.Second,
	}
	pm.clients[route.ID] = client
	return client
}

func baseTransport() *http.Transport {
	return &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
		ForceAttemptHTTP2:   true,
	}
}

// ForgetProxy invalidates a cached client so a route edit takes effect.
func ForgetProxy(routeID string) {
	proxyManager.mu.Lock()
	delete(proxyManager.clients, routeID)
	proxyManager.mu.Unlock()
}
