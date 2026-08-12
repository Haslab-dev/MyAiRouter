package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type RoutingConfig struct {
	PrimaryProvider  string  `json:"primary_provider"`
	FallbackProvider *string `json:"fallback_provider,omitempty"`
	FallbackModel    *string `json:"fallback_model,omitempty"`
}

type CompressionConfig struct {
	Enabled                bool   `json:"enabled"`
	Strategy               string `json:"strategy"`
	Trigger                string `json:"trigger"` // "context_limit" or "threshold"
	ThresholdTokens        int    `json:"threshold_tokens"`
	PreserveRecentMessages int    `json:"preserve_recent_messages"`
}

type ModelConfig struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Routing     RoutingConfig     `json:"routing"`
	Compression CompressionConfig `json:"compression"`
	CreatedAt   string            `json:"createdAt,omitempty"`
	UpdatedAt   string            `json:"updatedAt,omitempty"`
}

func CreateModelConfig(cfg *ModelConfig) (*ModelConfig, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	cfg.CreatedAt = now
	cfg.UpdatedAt = now
	fallbackVal := interface{}(nil)
	if cfg.Routing.FallbackProvider != nil {
		fallbackVal = *cfg.Routing.FallbackProvider
	}
	fallbackModelVal := interface{}(nil)
	if cfg.Routing.FallbackModel != nil {
		fallbackModelVal = *cfg.Routing.FallbackModel
	}

	compEnabled := 0
	if cfg.Compression.Enabled {
		compEnabled = 1
	}

	_, err := DB.Exec(
		`INSERT INTO models (
			id, name, primary_provider, fallback_provider, fallback_model, 
			compression_enabled, compression_strategy, compression_trigger, compression_threshold, preserve_recent_messages, 
			createdAt, updatedAt
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		cfg.ID, cfg.Name, cfg.Routing.PrimaryProvider, fallbackVal, fallbackModelVal,
		compEnabled, cfg.Compression.Strategy, cfg.Compression.Trigger, cfg.Compression.ThresholdTokens, cfg.Compression.PreserveRecentMessages,
		cfg.CreatedAt, cfg.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("creating model config: %w", err)
	}

	return cfg, nil
}

func GetModelConfig(id string) (*ModelConfig, error) {
	var cfg ModelConfig
	var fallback sql.NullString
	var fallbackModel sql.NullString
	var compEnabled int

	err := DB.QueryRow(
		`SELECT 
			id, name, primary_provider, fallback_provider, fallback_model, 
			compression_enabled, compression_strategy, compression_trigger, compression_threshold, preserve_recent_messages, 
			createdAt, updatedAt
		FROM models WHERE id = ?`,
		id,
	).Scan(
		&cfg.ID, &cfg.Name, &cfg.Routing.PrimaryProvider, &fallback, &fallbackModel,
		&compEnabled, &cfg.Compression.Strategy, &cfg.Compression.Trigger, &cfg.Compression.ThresholdTokens, &cfg.Compression.PreserveRecentMessages,
		&cfg.CreatedAt, &cfg.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	cfg.Compression.Enabled = compEnabled == 1
	if fallback.Valid {
		val := fallback.String
		cfg.Routing.FallbackProvider = &val
	}
	if fallbackModel.Valid {
		val := fallbackModel.String
		cfg.Routing.FallbackModel = &val
	}
	if cfg.Routing.FallbackModel == nil && cfg.Routing.FallbackProvider != nil {
		val := *cfg.Routing.FallbackProvider + "/" + cfg.Name
		cfg.Routing.FallbackModel = &val
	}

	return &cfg, nil
}

func GetModelConfigOrDefault(id string) *ModelConfig {
	cfg, err := GetModelConfig(id)
	if err == nil && cfg != nil {
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

func UpdateModelConfig(id string, cfg *ModelConfig) error {
	now := time.Now().UTC().Format(time.RFC3339)
	cfg.UpdatedAt = now

	fallbackVal := interface{}(nil)
	if cfg.Routing.FallbackProvider != nil {
		fallbackVal = *cfg.Routing.FallbackProvider
	}
	fallbackModelVal := interface{}(nil)
	if cfg.Routing.FallbackModel != nil {
		fallbackModelVal = *cfg.Routing.FallbackModel
	}

	compEnabled := 0
	if cfg.Compression.Enabled {
		compEnabled = 1
	}

	_, err := DB.Exec(
		`UPDATE models SET 
			name = ?, primary_provider = ?, fallback_provider = ?, fallback_model = ?, 
			compression_enabled = ?, compression_strategy = ?, compression_trigger = ?, compression_threshold = ?, preserve_recent_messages = ?, 
			updatedAt = ?
		WHERE id = ?`,
		cfg.Name, cfg.Routing.PrimaryProvider, fallbackVal, fallbackModelVal,
		compEnabled, cfg.Compression.Strategy, cfg.Compression.Trigger, cfg.Compression.ThresholdTokens, cfg.Compression.PreserveRecentMessages,
		cfg.UpdatedAt, id,
	)
	return err
}

func SaveModelConfig(cfg *ModelConfig) error {
	existing, err := GetModelConfig(cfg.ID)
	if err != nil {
		if err == sql.ErrNoRows {
			_, err = CreateModelConfig(cfg)
			return err
		}
		return err
	}
	cfg.CreatedAt = existing.CreatedAt
	return UpdateModelConfig(cfg.ID, cfg)
}

func DeleteModelConfig(id string) error {
	_, err := DB.Exec("DELETE FROM models WHERE id = ?", id)
	return err
}

func ListModelConfigs() ([]ModelConfig, error) {
	rows, err := DB.Query(
		`SELECT 
			id, name, primary_provider, fallback_provider, fallback_model, 
			compression_enabled, compression_strategy, compression_trigger, compression_threshold, preserve_recent_messages, 
			createdAt, updatedAt
		FROM models ORDER BY id ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []ModelConfig
	for rows.Next() {
		var cfg ModelConfig
		var fallback sql.NullString
		var fallbackModel sql.NullString
		var compEnabled int

		err := rows.Scan(
			&cfg.ID, &cfg.Name, &cfg.Routing.PrimaryProvider, &fallback, &fallbackModel,
			&compEnabled, &cfg.Compression.Strategy, &cfg.Compression.Trigger, &cfg.Compression.ThresholdTokens, &cfg.Compression.PreserveRecentMessages,
			&cfg.CreatedAt, &cfg.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}

		cfg.Compression.Enabled = compEnabled == 1
		if fallback.Valid {
			val := fallback.String
			cfg.Routing.FallbackProvider = &val
		}
		if fallbackModel.Valid {
			val := fallbackModel.String
			cfg.Routing.FallbackModel = &val
		}
		if cfg.Routing.FallbackModel == nil && cfg.Routing.FallbackProvider != nil {
			val := *cfg.Routing.FallbackProvider + "/" + cfg.Name
			cfg.Routing.FallbackModel = &val
		}
		list = append(list, cfg)
	}
	return list, nil
}
