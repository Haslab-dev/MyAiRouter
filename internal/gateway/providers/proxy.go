package providers

import (
	"net/http"
	"net/url"
	"sync"
	"time"

	"myAiRouter/pkg/db"
	"golang.org/x/net/proxy"
)

// proxyManager keeps one *http.Client per proxy route id so proxied
// connections keep-alive instead of rebuilding the dialer every request.
type proxyManagerType struct {
	mu      sync.RWMutex
	clients map[string]*http.Client
}

var proxyManager = &proxyManagerType{
	clients: make(map[string]*http.Client),
}

func (pm *proxyManagerType) clientFor(route *db.ProxyRoute) *http.Client {
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

// ForgetProxy invalidates a cached client so route edits take effect.
func ForgetProxy(routeID string) {
	proxyManager.mu.Lock()
	delete(proxyManager.clients, routeID)
	proxyManager.mu.Unlock()
}

func baseTransport() *http.Transport {
	return &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
		ForceAttemptHTTP2:   true,
	}
}
