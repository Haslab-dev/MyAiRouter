package db

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type Combo struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"`
	Models    []string `json:"models"` // Serialized to 'models' TEXT column
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
}

func CreateCombo(combo *Combo) (*Combo, error) {
	if combo.ID == "" {
		combo.ID = uuid.New().String()
	}
	combo.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	combo.UpdatedAt = combo.CreatedAt

	modelsBytes, err := json.Marshal(combo.Models)
	if err != nil {
		return nil, err
	}

	_, err = DB.Exec(
		"INSERT INTO combos (id, name, kind, models, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)",
		combo.ID, combo.Name, combo.Kind, string(modelsBytes), combo.CreatedAt, combo.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return combo, nil
}

func ListCombos() ([]Combo, error) {
	rows, err := DB.Query("SELECT id, name, kind, models, createdAt, updatedAt FROM combos ORDER BY name ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Combo
	for rows.Next() {
		var c Combo
		var modelsStr string
		if err := rows.Scan(&c.ID, &c.Name, &c.Kind, &modelsStr, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(modelsStr), &c.Models)
		list = append(list, c)
	}
	return list, nil
}

func GetComboByName(name string) (*Combo, error) {
	var c Combo
	var modelsStr string
	err := DB.QueryRow("SELECT id, name, kind, models, createdAt, updatedAt FROM combos WHERE name = ?", name).Scan(&c.ID, &c.Name, &c.Kind, &modelsStr, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(modelsStr), &c.Models)
	return &c, nil
}

func DeleteCombo(id string) error {
	_, err := DB.Exec("DELETE FROM combos WHERE id = ?", id)
	return err
}
