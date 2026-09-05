package db

import (
	"encoding/json"
	"strings"
	"sync/atomic"
)

// routingSnapshot is an in-memory copy of all routing-relevant configuration
// (settings, combos, model policies, connections, custom models, pricing).
//
// The gateway hot path reads exclusively from this snapshot so a request never
// pays a SQLite round-trip for configuration; every admin mutation drops the
// snapshot and the next read rebuilds it. This is configuration caching only —
// responses are never cached anywhere in the gateway.
type routingSnapshot struct {
	settings         *Settings
	combos           []Combo
	modelConfigs     map[string]*ModelConfig
	connections      []ProviderConnection
	activeByProvider map[string][]ProviderConnection
	customModels     []CustomModel
	pricingOverrides map[string]ModelRate // "provider|model" -> rate
	enabledModels    map[string][]string  // provider -> ids (nil = all allowed)
}

var snapshotPtr atomic.Pointer[routingSnapshot]

// InvalidateRoutingSnapshot drops the cached configuration; the next reader
// rebuilds it from SQLite. Called by every admin mutation path.
func InvalidateRoutingSnapshot() {
	snapshotPtr.Store(nil)
}

func getRoutingSnapshot() *routingSnapshot {
	if s := snapshotPtr.Load(); s != nil {
		return s
	}
	s := buildRoutingSnapshot()
	snapshotPtr.Store(s)
	return s
}

func buildRoutingSnapshot() *routingSnapshot {
	snap := &routingSnapshot{
		modelConfigs:     make(map[string]*ModelConfig),
		activeByProvider: make(map[string][]ProviderConnection),
		pricingOverrides: make(map[string]ModelRate),
		enabledModels:    make(map[string][]string),
	}

	if settings, err := loadSettingsFromDB(); err == nil && settings != nil {
		snap.settings = settings
	}
	if combos, err := listCombosFromDB(); err == nil {
		snap.combos = combos
	}
	if configs, err := listModelConfigsFromDB(); err == nil {
		for i := range configs {
			snap.modelConfigs[configs[i].ID] = &configs[i]
		}
	}
	if conns, err := listConnectionsFromDB(); err == nil {
		snap.connections = conns
		for _, c := range conns {
			if c.IsActive {
				snap.activeByProvider[c.Provider] = append(snap.activeByProvider[c.Provider], c)
			}
		}
	}
	if customs, err := listCustomModelsFromDB(); err == nil {
		snap.customModels = customs
	}

	if DB != nil {
		if rows, err := DB.Query("SELECT key, value FROM kv WHERE scope = ?", PricingOverridesScope); err == nil {
			for rows.Next() {
				var k, val string
				if err := rows.Scan(&k, &val); err != nil {
					continue
				}
				var rec PricingOverrideRecord
				if err := json.Unmarshal([]byte(val), &rec); err != nil {
					continue
				}
				snap.pricingOverrides[k] = ModelRate{Input: rec.Input, Output: rec.Output, Cached: rec.Cached}
			}
			rows.Close()
		}
		if rows, err := DB.Query("SELECT key, value FROM kv WHERE scope = ?", EnabledModelsScope); err == nil {
			for rows.Next() {
				var k, val string
				if err := rows.Scan(&k, &val); err != nil {
					continue
				}
				var ids []string
				if err := json.Unmarshal([]byte(val), &ids); err != nil {
					continue
				}
				snap.enabledModels[k] = ids
			}
			rows.Close()
		}
	}

	return snap
}

// SnapshotAllConnections returns every connection from the snapshot.
func SnapshotAllConnections() []ProviderConnection {
	return getRoutingSnapshot().connections
}

// snapshotModelConfig resolves a model policy from the snapshot with the same
// defaults as GetModelConfigOrDefault.
func (s *routingSnapshot) modelConfig(id string) *ModelConfig {
	if cfg, ok := s.modelConfigs[id]; ok {
		return cfg
	}
	primaryProvider := "openai"
	modelName := id
	if idx := strings.Index(id, "/"); idx != -1 {
		primaryProvider = id[:idx]
		modelName = id[idx+1:]
	}
	return &ModelConfig{
		ID:   id,
		Name: modelName,
		Routing: RoutingConfig{
			PrimaryProvider: primaryProvider,
		},
		Compression: CompressionConfig{
			Enabled:                false,
			Strategy:               "balanced",
			Trigger:                "threshold",
			ThresholdTokens:        64000,
			PreserveRecentMessages: 20,
		},
	}
}

// snapshotPricingOverride mirrors GetPricingOverride precedence: exact
// "provider|model" key first, then the base model without a prefix.
func (s *routingSnapshot) pricingOverride(provider, model string) (ModelRate, bool) {
	p := strings.ToLower(strings.TrimSpace(provider))
	m := strings.ToLower(strings.TrimSpace(model))
	if rate, ok := s.pricingOverrides[p+"|"+m]; ok {
		return rate, true
	}
	if idx := strings.Index(m, "/"); idx != -1 {
		if rate, ok := s.pricingOverrides[p+"|"+m[idx+1:]]; ok {
			return rate, true
		}
	}
	return ModelRate{}, false
}
