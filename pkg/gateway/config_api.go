package gateway

import (
	"encoding/json"
	"net/http"

	"myAiRouter/pkg/db"
)

// ConfigBundle is the portable, machine-independent slice of the setup:
// providers, combos, model configs, custom models, nodes, proxy routes and
// settings. Usage history, traces and chat sessions are deliberately excluded
// — they are machine-local telemetry, not configuration.
type ConfigBundle struct {
	Version    string                     `json:"version"`
	ExportedAt string                     `json:"exportedAt"`
	Providers  []db.ProviderConnection    `json:"providers"`
	Nodes      []db.ProviderNode          `json:"nodes"`
	Combos     []db.Combo                 `json:"combos"`
	Models     []db.ModelConfig           `json:"modelConfigs"`
	Custom     []db.CustomModel           `json:"customModels"`
	Proxies    []db.ProxyRoute            `json:"proxyRoutes"`
	Settings   map[string]interface{}     `json:"settings"`
}

// HandleConfigExport streams the whole portable configuration as one JSON
// file, so a working setup can be versioned or moved to another machine.
// Credentials inside connection data are included — the file is a secret.
func HandleConfigExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteErrorResponse(w, http.StatusMethodNotAllowed, "Use GET")
		return
	}

	bundle := ConfigBundle{Version: AppVersion}
	if ps, err := db.ListConnections(); err == nil {
		bundle.Providers = ps
	}
	if ns, err := db.ListProviderNodes(); err == nil {
		bundle.Nodes = ns
	}
	if cs, err := db.ListCombos(); err == nil {
		bundle.Combos = cs
	}
	if ms, err := db.ListModelConfigs(); err == nil {
		bundle.Models = ms
	}
	if cms, err := db.GetCustomModels(); err == nil {
		bundle.Custom = cms
	}
	if px, err := db.ListProxyRoutes(); err == nil {
		bundle.Proxies = px
	}
	if st, err := db.GetSettings(); err == nil {
		if raw, err := json.Marshal(st); err == nil {
			_ = json.Unmarshal(raw, &bundle.Settings)
		}
	}
	// Never export the dashboard password hash — it is machine/instance local.
	if bundle.Settings != nil {
		delete(bundle.Settings, "passwordHash")
		delete(bundle.Settings, "requireLogin")
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=\"myairouter-config.json\"")
	_ = json.NewEncoder(w).Encode(bundle)
}

// HandleConfigImport restores a bundle produced by HandleConfigExport.
// Import is additive: existing records with the same id are updated in place,
// new ones are created. Nothing is deleted, so a bad import cannot wipe a
// working setup.
func HandleConfigImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteErrorResponse(w, http.StatusMethodNotAllowed, "Use POST")
		return
	}

	var bundle ConfigBundle
	if err := json.NewDecoder(r.Body).Decode(&bundle); err != nil {
		WriteErrorResponse(w, http.StatusBadRequest, "Invalid config JSON: "+err.Error())
		return
	}

	restored := map[string]int{"providers": 0, "nodes": 0, "combos": 0, "modelConfigs": 0, "customModels": 0, "proxyRoutes": 0}

	for _, p := range bundle.Providers {
		if err := db.UpsertConnection(&p); err == nil {
			restored["providers"]++
		}
	}
	for _, n := range bundle.Nodes {
		if err := db.UpsertProviderNode(&n); err == nil {
			restored["nodes"]++
		}
	}
	for _, c := range bundle.Combos {
		if err := db.UpsertCombo(&c); err == nil {
			restored["combos"]++
		}
	}
	for _, m := range bundle.Models {
		if err := db.UpdateModelConfig(m.ID, &m); err == nil {
			restored["modelConfigs"]++
		}
	}
	for _, cm := range bundle.Custom {
		if err := db.UpsertCustomModel(&cm); err == nil {
			restored["customModels"]++
		}
	}
	for _, pr := range bundle.Proxies {
		if err := db.UpsertProxyRoute(&pr); err == nil {
			restored["proxyRoutes"]++
		}
	}

	db.InvalidateRoutingSnapshot()
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "restored": restored})
}

// HandleBackupNow creates a database backup on demand.
func HandleBackupNow(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteErrorResponse(w, http.StatusMethodNotAllowed, "Use POST")
		return
	}
	path, err := db.BackupNow()
	if err != nil {
		WriteErrorResponse(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "path": path})
}
