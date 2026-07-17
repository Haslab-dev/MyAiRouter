package db

import (
	"encoding/json"
)

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
