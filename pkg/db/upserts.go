package db

import (
	"encoding/json"
	"time"
)

// Upserts used by config import. They restore a record with its ORIGINAL id,
// updating in place when the id already exists (additive import), so a bad
// import can never delete a working setup.

func encodeJSON(v interface{}) string {
	raw, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(raw)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func UpsertConnection(c *ProviderConnection) error {
	if c.ID == "" {
		_, err := CreateConnection(c)
		return err
	}
	res, err := DB.Exec(`INSERT INTO providerConnections (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, authType=excluded.authType, name=excluded.name,
			email=excluded.email, priority=excluded.priority, isActive=excluded.isActive, data=excluded.data, updatedAt=excluded.updatedAt`,
		c.ID, c.Provider, c.AuthType, c.Name, c.Email, c.Priority, boolToInt(c.IsActive), encodeJSON(c.Data), c.CreatedAt, nowRFC3339())
	_ = res
	return err
}

func UpsertProviderNode(n *ProviderNode) error {
	_, err := DB.Exec(`INSERT INTO providerNodes (id, type, name, data, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET type=excluded.type, name=excluded.name, data=excluded.data, updatedAt=excluded.updatedAt`,
		n.ID, n.Type, n.Name, encodeJSON(n.Data), n.CreatedAt, nowRFC3339())
	return err
}

func UpsertCombo(c *Combo) error {
	if c.ID == "" {
		_, err := CreateCombo(c)
		return err
	}
	_, err := DB.Exec(`INSERT INTO combos (id, name, kind, models, policy, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, models=excluded.models, policy=excluded.policy, updatedAt=excluded.updatedAt`,
		c.ID, c.Name, c.Kind, encodeJSON(c.Models), encodeJSON(c.Policy), c.CreatedAt, nowRFC3339())
	return err
}

func UpsertCustomModel(cm *CustomModel) error {
	_, err := DB.Exec(`INSERT INTO kv (scope, key, value) VALUES (?, ?, ?)
		ON CONFLICT(scope, key) DO UPDATE SET value=excluded.value`,
		CustomModelsScope, customKey(cm.ProviderAlias, cm.ID, cm.Type), encodeJSON(cm))
	return err
}

func UpsertProxyRoute(p *ProxyRoute) error {
	if p.ID == "" {
		_, err := CreateProxyRoute(p)
		return err
	}
	_, err := DB.Exec(`INSERT INTO proxyRoutes (id, name, scheme, host, port, username, password, isEnabled, createdAt, updatedAt)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, scheme=excluded.scheme, host=excluded.host, port=excluded.port,
			username=excluded.username, password=excluded.password, isEnabled=excluded.isEnabled, updatedAt=excluded.updatedAt`,
		p.ID, p.Name, p.Scheme, p.Host, p.Port, p.Username, p.Password, boolToInt(p.IsEnabled), p.CreatedAt, nowRFC3339())
	return err
}
