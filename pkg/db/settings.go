package db

import (
	"encoding/json"
)

type PipelineStep struct {
	Name    string                 `json:"name"`
	Enabled bool                   `json:"enabled"`
	Config  map[string]interface{} `json:"config"`
}

type Settings struct {
	RtkEnabled      bool   `json:"rtkEnabled"`
	HeadroomEnabled bool   `json:"headroomEnabled"`
	HeadroomUrl     string `json:"headroomUrl"`
	CavemanEnabled  bool   `json:"cavemanEnabled"`
	CavemanLevel    string `json:"cavemanLevel"`
	PonytailEnabled bool   `json:"ponytailEnabled"`
	PonytailLevel   string `json:"ponytailLevel"`
	RequireLogin    bool   `json:"requireLogin"`
	PasswordHash    string `json:"passwordHash"`

	// New prompt optimizer fields
	OptimizerEnabled     bool           `json:"optimizerEnabled"`
	OptimizationEngine   string         `json:"optimizationEngine"`
	OptimizationProfile  string         `json:"optimizationProfile"`
	OptimizationGoal     string         `json:"optimizationGoal"`
	PipelineSteps        []PipelineStep `json:"pipelineSteps"`
	TraceStorageMode     string         `json:"traceStorageMode"`
}

func GetSettings() (*Settings, error) {
	var dataStr string
	err := DB.QueryRow("SELECT data FROM settings WHERE id = 1").Scan(&dataStr)
	if err != nil {
		return nil, err
	}

	var settings Settings
	if err := json.Unmarshal([]byte(dataStr), &settings); err != nil {
		return nil, err
	}

	// Apply default values for dynamic migration fallback
	if settings.OptimizationEngine == "" {
		settings.OptimizationEngine = "auto"
	}
	if settings.OptimizationProfile == "" {
		settings.OptimizationProfile = "balanced"
	}
	if settings.OptimizationGoal == "" {
		settings.OptimizationGoal = "balanced"
	}
	if len(settings.PipelineSteps) == 0 {
		settings.PipelineSteps = []PipelineStep{
			{Name: "tool", Enabled: true, Config: nil},
			{Name: "structure", Enabled: true, Config: nil},
			{Name: "dedup", Enabled: true, Config: nil},
			{Name: "markdown", Enabled: true, Config: nil},
		}
	}
	if settings.TraceStorageMode == "" {
		settings.TraceStorageMode = "store_both" // Default is permissive for benchmark replays
	}

	return &settings, nil
}

func UpdateSettings(updates map[string]interface{}) (*Settings, error) {
	// First load current settings
	current, err := GetSettings()
	if err != nil {
		return nil, err
	}

	// Marshal back to map to merge
	currentBytes, err := json.Marshal(current)
	if err != nil {
		return nil, err
	}

	var currentMap map[string]interface{}
	if err := json.Unmarshal(currentBytes, &currentMap); err != nil {
		return nil, err
	}

	// Merge updates
	for k, v := range updates {
		currentMap[k] = v
	}

	// Marshal back to struct
	mergedBytes, err := json.Marshal(currentMap)
	if err != nil {
		return nil, err
	}

	var merged Settings
	if err := json.Unmarshal(mergedBytes, &merged); err != nil {
		return nil, err
	}

	// Save to DB
	_, err = DB.Exec("UPDATE settings SET data = ? WHERE id = 1", string(mergedBytes))
	if err != nil {
		return nil, err
	}

	return &merged, nil
}
