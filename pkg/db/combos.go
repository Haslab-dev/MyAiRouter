package db

import (
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Combo struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Kind      string         `json:"kind"`
	Models    []string       `json:"models"`           // Serialized to 'models' TEXT column
	Policy    *AttemptPolicy `json:"policy,omitempty"` // Serialized to 'policy' TEXT column
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
}

// AttemptPolicy tunes the fallback engine per combo. Zero values fall back to
// the engine defaults, so existing combos keep their behavior untouched.
type AttemptPolicy struct {
	AttemptTimeoutMs int    `json:"attemptTimeoutMs,omitempty"` // per-attempt timeout while more targets remain (default 3500)
	FinalTimeoutMs   int    `json:"finalTimeoutMs,omitempty"`   // timeout for the last target (default 60000)
	MaxFallbacks     int    `json:"maxFallbacks,omitempty"`     // cap on fallback hops (default: unlimited)
	FallbackPolicy   string `json:"fallbackPolicy,omitempty"`   // auto (default) | aggressive | conservative
}

const (
	FallbackPolicyAuto         = "auto"
	FallbackPolicyAggressive   = "aggressive"
	FallbackPolicyConservative = "conservative"

	DefaultAttemptTimeoutMs = 3500
	DefaultFinalTimeoutMs   = 60000
)

// AttemptTimeout is the per-attempt timeout applied while more targets remain.
func (p *AttemptPolicy) AttemptTimeout() time.Duration {
	if p != nil && p.AttemptTimeoutMs > 0 {
		return time.Duration(p.AttemptTimeoutMs) * time.Millisecond
	}
	return DefaultAttemptTimeoutMs * time.Millisecond
}

// FinalTimeout is the timeout applied to the last target, which must be
// allowed to run to completion.
func (p *AttemptPolicy) FinalTimeout() time.Duration {
	if p != nil && p.FinalTimeoutMs > 0 {
		return time.Duration(p.FinalTimeoutMs) * time.Millisecond
	}
	return DefaultFinalTimeoutMs * time.Millisecond
}

// MaxFallbackCount caps fallback hops; zero means unlimited (all targets).
func (p *AttemptPolicy) MaxFallbackCount() int {
	if p != nil && p.MaxFallbacks > 0 {
		return p.MaxFallbacks
	}
	return 0
}

// Normalized returns a copy with unknown fallback policies coerced to auto.
func (p *AttemptPolicy) Normalized() *AttemptPolicy {
	if p == nil {
		return nil
	}
	out := *p
	switch out.FallbackPolicy {
	case FallbackPolicyAggressive, FallbackPolicyConservative:
	default:
		out.FallbackPolicy = FallbackPolicyAuto
	}
	return &out
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
	policyBytes, err := json.Marshal(combo.Policy)
	if err != nil {
		return nil, err
	}

	_, err = DB.Exec(
		"INSERT INTO combos (id, name, kind, models, policy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
		combo.ID, combo.Name, combo.Kind, string(modelsBytes), string(policyBytes), combo.CreatedAt, combo.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	InvalidateRoutingSnapshot()
	return combo, nil
}

func ListCombos() ([]Combo, error) {
	return listCombosFromDB()
}

func listCombosFromDB() ([]Combo, error) {
	rows, err := DB.Query("SELECT id, name, kind, models, policy, createdAt, updatedAt FROM combos ORDER BY name ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Combo
	for rows.Next() {
		var c Combo
		var modelsStr string
		var policyStr sql.NullString
		if err := rows.Scan(&c.ID, &c.Name, &c.Kind, &modelsStr, &policyStr, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(modelsStr), &c.Models)
		if policyStr.Valid && policyStr.String != "" {
			var policy AttemptPolicy
			if err := json.Unmarshal([]byte(policyStr.String), &policy); err == nil {
				c.Policy = &policy
			}
		}
		list = append(list, c)
	}
	return list, nil
}

func GetComboByName(name string) (*Combo, error) {
	return ResolveCombo(name)
}

func ResolveCombo(modelOrName string) (*Combo, error) {
	combos := getRoutingSnapshot().combos
	if len(combos) == 0 {
		return nil, sql.ErrNoRows
	}

	modelLower := strings.ToLower(strings.TrimSpace(modelOrName))

	// Match ONLY exact or case-insensitive combo Name or combo ID
	for _, c := range combos {
		if strings.ToLower(c.Name) == modelLower || strings.ToLower(c.ID) == modelLower {
			return &c, nil
		}
	}

	return nil, sql.ErrNoRows
}

func DeleteCombo(id string) error {
	_, err := DB.Exec("DELETE FROM combos WHERE id = ?", id)
	InvalidateRoutingSnapshot()
	return err
}

func UpdateCombo(id string, name, kind string, models []string, policy *AttemptPolicy) error {
	modelsBytes, err := json.Marshal(models)
	if err != nil {
		return err
	}
	policyBytes, err := json.Marshal(policy)
	if err != nil {
		return err
	}
	_, err = DB.Exec("UPDATE combos SET name = ?, kind = ?, models = ?, policy = ?, updatedAt = ? WHERE id = ?", name, kind, string(modelsBytes), string(policyBytes), time.Now().UTC().Format(time.RFC3339), id)
	InvalidateRoutingSnapshot()
	return err
}
