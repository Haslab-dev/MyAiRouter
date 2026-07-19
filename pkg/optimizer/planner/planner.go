package planner

import (
	"myAiRouter/pkg/db"
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/registry"
)

type ExecutionPlan struct {
	EngineName   string           `json:"engineName"`
	RoutedEngine string           `json:"routedEngine"`
	Goal         string           `json:"goal"`
	ProfileName  string           `json:"profileName"`
	TargetRatio  float64          `json:"targetRatio"`
	ActivePasses []optimizer.Pass `json:"-"`
	PassNames    []string         `json:"passNames"`
	PlannerLogs  []string         `json:"plannerLogs"`
}

type Planner struct{}

func NewPlanner() *Planner {
	return &Planner{}
}

func (p *Planner) Plan(ctx *optimizer.OptimizationContext, engine string, enabledSteps []db.PipelineStep) (*ExecutionPlan, error) {
	plan := &ExecutionPlan{
		EngineName:  engine,
		Goal:        ctx.Goal,
		ProfileName: ctx.Profile.Name,
		TargetRatio: ctx.Profile.TargetRatio,
	}

	// 1. Resolve Dynamic Engine (Smart / Auto Routing)
	routed := engine
	if engine == "auto" || engine == "smart" {
		plan.PlannerLogs = append(plan.PlannerLogs, "Smart routing mode initialized.")
		if ctx.ContentType == "json" || ctx.ContentType == "code" || ctx.HasJSON || ctx.HasCode {
			routed = "structure"
			plan.PlannerLogs = append(plan.PlannerLogs, "Detected high density JSON or source code. Routed to: structure engine.")
		} else if ctx.ContentType == "log" || ctx.HasLogs {
			routed = "tool"
			plan.PlannerLogs = append(plan.PlannerLogs, "Detected tool commands/terminal output. Routed to: tool engine.")
		} else {
			routed = "fusion"
			plan.PlannerLogs = append(plan.PlannerLogs, "Detected general unstructured text. Routed to: fusion engine.")
		}
	} else {
		// Handle legacy mapping
		if engine == "headroom" {
			routed = "structure"
		} else if engine == "rtk" {
			routed = "tool"
		} else if engine == "hybrid" {
			routed = "fusion"
		}
		plan.PlannerLogs = append(plan.PlannerLogs, "Explicit engine selected: "+routed)
	}
	plan.RoutedEngine = routed

	// 2. Load passes based on selected/routed engine metadata from Registry
	var candidatePassNames []string
	if engineConfig, exists := registry.GetEngine(routed); exists {
		candidatePassNames = engineConfig.DefaultPasses
	} else {
		candidatePassNames = []string{"tool", "structure", "dedup", "markdown"}
	}

	if len(enabledSteps) > 0 {
		enabledMap := make(map[string]bool)
		for _, step := range enabledSteps {
			name := step.Name
			if name == "rtk" {
				name = "tool"
			}
			if name == "headroom" {
				name = "structure"
			}

			if step.Enabled {
				enabledMap[name] = true
			}
		}
		var filtered []string
		for _, name := range candidatePassNames {
			if enabledMap[name] {
				filtered = append(filtered, name)
			}
		}
		candidatePassNames = filtered
	}

	// 3. Goal constraints overrides
	var finalPassNames []string
	switch ctx.Goal {
	case "speed":
		plan.PlannerLogs = append(plan.PlannerLogs, "Goal 'speed' constraint applied: filtering out expensive structural passes.")
		for _, name := range candidatePassNames {
			if name == "tool" {
				finalPassNames = append(finalPassNames, name)
			}
		}
	case "accuracy":
		plan.PlannerLogs = append(plan.PlannerLogs, "Goal 'accuracy' constraint applied: skipping lossy text deduplication.")
		for _, name := range candidatePassNames {
			if name == "tool" || name == "structure" {
				finalPassNames = append(finalPassNames, name)
			}
		}
	default:
		finalPassNames = candidatePassNames
	}

	// 4. Resolve pass objects and sort dynamically
	var activePasses []optimizer.Pass
	for _, name := range finalPassNames {
		if pass := registry.GetPass(name); pass != nil {
			if pass.CanRun(ctx) {
				activePasses = append(activePasses, pass)
			} else {
				plan.PlannerLogs = append(plan.PlannerLogs, "Pass "+name+" skipped: Context check CanRun returned false.")
			}
		}
	}

	plan.ActivePasses = sortPasses(activePasses)

	plan.PassNames = make([]string, len(plan.ActivePasses))
	for i, pass := range plan.ActivePasses {
		plan.PassNames[i] = pass.Name()
	}

	return plan, nil
}

func sortPasses(list []optimizer.Pass) []optimizer.Pass {
	if len(list) <= 1 {
		return list
	}

	sorted := make([]optimizer.Pass, len(list))
	copy(sorted, list)

	for i := 0; i < len(sorted); i++ {
		for j := 0; j < len(sorted)-1; j++ {
			p1 := sorted[j]
			p2 := sorted[j+1]

			shouldSwap := false
			for _, afterName := range p1.After() {
				chkName := afterName
				if chkName == "rtk" {
					chkName = "tool"
				}
				if chkName == "headroom" {
					chkName = "structure"
				}

				if chkName == p2.Name() {
					shouldSwap = true
					break
				}
			}
			for _, beforeName := range p2.Before() {
				chkName := beforeName
				if chkName == "rtk" {
					chkName = "tool"
				}
				if chkName == "headroom" {
					chkName = "structure"
				}

				if chkName == p1.Name() {
					shouldSwap = true
					break
				}
			}

			if shouldSwap {
				sorted[j], sorted[j+1] = sorted[j+1], sorted[j]
			}
		}
	}

	return sorted
}
