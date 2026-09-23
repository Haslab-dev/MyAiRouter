package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"myAiRouter/pkg/db"
)

// handleProxyRoutes — CRUD for outbound proxy routes.
func handleProxyRoutes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodGet {
		routes, err := db.ListProxyRoutes()
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		if routes == nil {
			routes = []db.ProxyRoute{}
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"routes": routes})
		return
	}

	if r.Method == http.MethodPost {
		var p db.ProxyRoute
		if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}
		if p.Host == "" || p.Port == 0 {
			WriteErrorResponse(w, http.StatusBadRequest, "host and port are required")
			return
		}
		switch p.Scheme {
		case "http", "https", "socks5":
		default:
			p.Scheme = "http"
		}
		created, err := db.CreateProxyRoute(&p)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		_ = json.NewEncoder(w).Encode(created)
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func handleProxyRouteDetail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	path := strings.TrimPrefix(r.URL.Path, "/api/proxies/")
	id := strings.Split(path, "/")[0]
	if id == "" {
		WriteErrorResponse(w, http.StatusBadRequest, "Missing proxy route ID")
		return
	}

	switch r.Method {
	case http.MethodPatch, http.MethodPut:
		var updates map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
			WriteErrorResponse(w, http.StatusBadRequest, "Invalid JSON")
			return
		}
		updated, err := db.UpdateProxyRoute(id, updates)
		if err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		ForgetProxy(id)
		_ = json.NewEncoder(w).Encode(updated)

	case http.MethodDelete:
		if err := db.DeleteProxyRoute(id); err != nil {
			WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
			return
		}
		ForgetProxy(id)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// handleProxyRouteTest verifies a proxy route by issuing a real request
// through it. The upstream identity endpoint echoes the public IP.
func handleProxyRouteTest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/proxies/test/")
	id := strings.Split(path, "/")[0]
	if id == "" {
		WriteErrorResponse(w, http.StatusBadRequest, "Missing proxy route ID")
		return
	}

	route, err := db.GetProxyRoute(id)
	if err != nil {
		WriteErrorResponse(w, http.StatusNotFound, "Proxy route not found")
		return
	}
	// Testing a disabled route is allowed — the operator may want to verify it
	// before enabling. The UI disables the button for clarity, but the API
	// stays honest.

	start := time.Now()
	client := proxyManager.clientFor(route)
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, "https://api.ipify.org?format=json", nil)
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	// The ipify call must look like a plain client too.
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "OpenAI/JS 4.77.0")

	resp, err := client.Do(req)
	latencyMs := float64(time.Since(start).Microseconds()) / 1000.0
	if err != nil {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"valid":     false,
			"error":     fmt.Sprintf("Proxy unreachable: %v", err),
			"latencyMs": latencyMs,
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"valid":     false,
			"error":     fmt.Sprintf("Proxy returned HTTP %d", resp.StatusCode),
			"latencyMs": latencyMs,
		})
		return
	}

	var out struct {
		IP string `json:"ip"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"valid":     true,
			"error":     "Connected but IP unreadable",
			"latencyMs": latencyMs,
		})
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"valid":     true,
		"ip":        out.IP,
		"latencyMs": latencyMs,
	})
}
