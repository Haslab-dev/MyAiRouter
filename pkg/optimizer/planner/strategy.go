package planner

import (
	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/registry"
)

func init() {
	// Auto (was smart)
	registry.RegisterEngine(optimizer.EngineMetadata{
		ID:             "auto",
		Name:           "Auto (Recommended)",
		Description:    "Analyzes prompt formats in real-time to route JSON, Code, and Logs to optimized sub-pipelines automatically.",
		EstimatedSpeed: "Fast (Dynamic)",
		Capabilities: optimizer.Capabilities{
			SupportsJson: true,
			SupportsCode: true,
			SupportsLogs: true,
		},
		DefaultPasses: []string{"tool", "structure", "dedup", "markdown"},
		References: []optimizer.Reference{
			{Name: "LLVM Compiler", URL: "https://llvm.org", Description: "Pass manager & topological optimization pipeline architecture"},
			{Name: "Headroom", URL: "https://github.com/headroom", Description: "Structure-preserving mask boundaries concept"},
			{Name: "RTK Bolt", URL: "https://github.com/rtk-bolt", Description: "Deterministic formatting filters"},
		},
	})

	// Tool (was rtk)
	registry.RegisterEngine(optimizer.EngineMetadata{
		ID:             "tool",
		Name:           "Tool Outputs Formatter",
		Description:    "Deterministic filters targeting command results, CLI printouts, diff files, and folder directories.",
		EstimatedSpeed: "Instant (Deterministic)",
		Capabilities: optimizer.Capabilities{
			SupportsJson: false,
			SupportsCode: false,
			SupportsLogs: true,
		},
		DefaultPasses: []string{"tool", "dedup"},
		References: []optimizer.Reference{
			{Name: "RTK Bolt", URL: "https://github.com/rtk-bolt", Description: "Dynamic log truncation patterns"},
		},
	})

	// Structure (was headroom)
	registry.RegisterEngine(optimizer.EngineMetadata{
		ID:             "structure",
		Name:           "Structure-Preserving Parser",
		Description:    "Guarantees schema integrity by preserving JSON keys, array counts, and programming language signature blocks.",
		EstimatedSpeed: "Moderate (Structure Sniffing)",
		Capabilities: optimizer.Capabilities{
			SupportsJson: true,
			SupportsCode: true,
			SupportsLogs: false,
		},
		DefaultPasses: []string{"structure"},
		References: []optimizer.Reference{
			{Name: "Headroom", URL: "https://github.com/headroom", Description: "Structure-preserving regex and character token boundaries"},
		},
	})

	// Fusion (was hybrid)
	registry.RegisterEngine(optimizer.EngineMetadata{
		ID:             "fusion",
		Name:           "Fusion Pipeline",
		Description:    "Sequentially triggers all active formatting and structural passes to achieve maximum token efficiency.",
		EstimatedSpeed: "Balanced",
		Capabilities: optimizer.Capabilities{
			SupportsJson: true,
			SupportsCode: true,
			SupportsLogs: true,
		},
		DefaultPasses: []string{"tool", "structure", "dedup", "markdown"},
		References: []optimizer.Reference{
			{Name: "Prompt Optimization Research", URL: "https://arxiv.org", Description: "Telegraphic prompt styling and semantic redundancy filtering"},
		},
	})
}
