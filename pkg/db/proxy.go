package db

import (
	"fmt"
	"time"
)

// ProxyRoute is an outbound HTTP(S) proxy the gateway can route provider
// requests through. Proxying per-connection is how 9Router hides the origin
// IP/fingerprint from upstream providers.
type ProxyRoute struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Scheme    string `json:"scheme"` // http | https | socks5
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Username  string `json:"username,omitempty"`
	Password  string `json:"password,omitempty"`
	IsEnabled bool   `json:"isEnabled"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func ProxyURL(p *ProxyRoute) string {
	if p == nil || p.Host == "" || p.Port == 0 {
		return ""
	}
	if p.Username != "" {
		return fmt.Sprintf("%s://%s:%s@%s:%d", p.Scheme, p.Username, p.Password, p.Host, p.Port)
	}
	return fmt.Sprintf("%s://%s:%d", p.Scheme, p.Host, p.Port)
}

func ListProxyRoutes() ([]ProxyRoute, error) {
	rows, err := DB.Query("SELECT id, name, scheme, host, port, username, password, isEnabled, createdAt, updatedAt FROM proxyRoutes ORDER BY createdAt ASC")
	if err != nil {
		return nil, fmt.Errorf("querying proxy routes: %w", err)
	}
	defer rows.Close()

	var list []ProxyRoute
	for rows.Next() {
		var p ProxyRoute
		var enabled int
		if err := rows.Scan(&p.ID, &p.Name, &p.Scheme, &p.Host, &p.Port, &p.Username, &p.Password, &enabled, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scanning proxy route: %w", err)
		}
		p.IsEnabled = enabled != 0
		list = append(list, p)
	}
	return list, nil
}

func GetProxyRoute(id string) (*ProxyRoute, error) {
	var p ProxyRoute
	var enabled int
	err := DB.QueryRow(
		"SELECT id, name, scheme, host, port, username, password, isEnabled, createdAt, updatedAt FROM proxyRoutes WHERE id = ?",
		id,
	).Scan(&p.ID, &p.Name, &p.Scheme, &p.Host, &p.Port, &p.Username, &p.Password, &enabled, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	p.IsEnabled = enabled != 0
	return &p, nil
}

func CreateProxyRoute(p *ProxyRoute) (*ProxyRoute, error) {
	if p.ID == "" {
		p.ID = "proxy-" + fmt.Sprintf("%d", time.Now().UnixNano())
	}
	if p.Scheme == "" {
		p.Scheme = "http"
	}
	now := time.Now().UTC().Format(time.RFC3339)
	p.CreatedAt = now
	p.UpdatedAt = now

	enabledVal := 0
	if p.IsEnabled {
		enabledVal = 1
	}
	_, err := DB.Exec(
		"INSERT INTO proxyRoutes (id, name, scheme, host, port, username, password, isEnabled, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		p.ID, p.Name, p.Scheme, p.Host, p.Port, p.Username, p.Password, enabledVal, p.CreatedAt, p.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("inserting proxy route: %w", err)
	}
	return p, nil
}

func UpdateProxyRoute(id string, updates map[string]interface{}) (*ProxyRoute, error) {
	current, err := GetProxyRoute(id)
	if err != nil {
		return nil, err
	}

	if v, ok := updates["name"].(string); ok {
		current.Name = v
	}
	if v, ok := updates["scheme"].(string); ok && v != "" {
		current.Scheme = v
	}
	if v, ok := updates["host"].(string); ok {
		current.Host = v
	}
	if v, ok := updates["port"].(float64); ok {
		current.Port = int(v)
	} else if v, ok := updates["port"].(int); ok {
		current.Port = v
	}
	if v, ok := updates["username"].(string); ok {
		current.Username = v
	}
	if v, ok := updates["password"].(string); ok {
		// Empty password on update = keep existing
		if v != "" {
			current.Password = v
		}
	}
	if v, ok := updates["isEnabled"].(bool); ok {
		current.IsEnabled = v
	}

	current.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	enabledVal := 0
	if current.IsEnabled {
		enabledVal = 1
	}

	_, err = DB.Exec(
		"UPDATE proxyRoutes SET name = ?, scheme = ?, host = ?, port = ?, username = ?, password = ?, isEnabled = ?, updatedAt = ? WHERE id = ?",
		current.Name, current.Scheme, current.Host, current.Port, current.Username, current.Password, enabledVal, current.UpdatedAt, id,
	)
	if err != nil {
		return nil, fmt.Errorf("updating proxy route: %w", err)
	}
	return current, nil
}

func DeleteProxyRoute(id string) error {
	_, err := DB.Exec("DELETE FROM proxyRoutes WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("deleting proxy route: %w", err)
	}
	return nil
}

// ProxyRouteForConnection resolves the proxy route attached to a connection
// (stored in the connection data JSON as "proxyRouteId").
func ProxyRouteForConnection(conn *ProviderConnection) (*ProxyRoute, error) {
	if conn == nil {
		return nil, nil
	}
	raw, ok := conn.Data["proxyRouteId"]
	if !ok {
		return nil, nil
	}
	id, ok := raw.(string)
	if id == "" || !ok {
		return nil, nil
	}
	return GetProxyRoute(id)
}
