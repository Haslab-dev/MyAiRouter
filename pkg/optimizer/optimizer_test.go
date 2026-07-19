package optimizer_test

import (
	"context"
	"testing"

	"myAiRouter/pkg/optimizer"
	"myAiRouter/pkg/optimizer/analyzers"
	"myAiRouter/pkg/optimizer/planner"
	"myAiRouter/pkg/optimizer/runner"
	_ "myAiRouter/pkg/optimizer/passes"
	_ "myAiRouter/pkg/optimizer/profiles"
	_ "myAiRouter/pkg/optimizer/validators"
)

func TestShannonEntropy(t *testing.T) {
	uuidStr := "8f14e45f-ceea-4123-8f14-e45fceea4123"
	lowEntStr := "aaaaa aaaaa aaaaa aaaaa"

	uuidEnt := analyzers.ComputeEntropy(uuidStr)
	lowEnt := analyzers.ComputeEntropy(lowEntStr)

	if uuidEnt < 0.80 {
		t.Errorf("expected high entropy for uuid, got %f", uuidEnt)
	}
	if lowEnt > 0.70 {
		t.Errorf("expected lower entropy for repetitive string, got %f", lowEnt)
	}
}

func TestContentAnalyzer(t *testing.T) {
	jsonPrompt := `{"users": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]}`
	logPrompt := "2026-07-19 INFO: system started\n2026-07-19 ERROR: connection failed"
	codePrompt := "def main():\n    print('hello world')\n\nimport os"

	ctx := &optimizer.OptimizationContext{
		Messages: []interface{}{
			map[string]interface{}{"role": "user", "content": jsonPrompt},
		},
	}
	analyzer := &analyzers.ContentAnalyzer{}
	if err := analyzer.Analyze(ctx); err != nil {
		t.Fatal(err)
	}
	if !ctx.HasJSON || ctx.ContentType != "json" {
		t.Errorf("expected JSON detection, got ContentType: %s", ctx.ContentType)
	}

	ctxLog := &optimizer.OptimizationContext{
		Messages: []interface{}{
			map[string]interface{}{"role": "user", "content": logPrompt},
		},
	}
	if err := analyzer.Analyze(ctxLog); err != nil {
		t.Fatal(err)
	}
	if !ctxLog.HasLogs || ctxLog.ContentType != "log" {
		t.Errorf("expected log detection, got ContentType: %s", ctxLog.ContentType)
	}

	ctxCode := &optimizer.OptimizationContext{
		Messages: []interface{}{
			map[string]interface{}{"role": "user", "content": codePrompt},
		},
	}
	if err := analyzer.Analyze(ctxCode); err != nil {
		t.Fatal(err)
	}
	if !ctxCode.HasCode || ctxCode.ContentType != "code" {
		t.Errorf("expected code detection, got ContentType: %s", ctxCode.ContentType)
	}
	
	langAnalyzer := &analyzers.LanguageAnalyzer{}
	_ = langAnalyzer.Analyze(ctxCode)
	if ctxCode.Language != "python" {
		t.Errorf("expected python language detection, got: %s", ctxCode.Language)
	}
}

func TestPlannerSmartRouting(t *testing.T) {
	plannerObj := planner.NewPlanner()

	ctxJSON := &optimizer.OptimizationContext{
		Goal:        "balanced",
		ContentType: "json",
		Profile:     optimizer.CompressionProfile{Name: "balanced", TargetRatio: 0.60},
	}
	plan, err := plannerObj.Plan(ctxJSON, "auto", nil)
	if err != nil {
		t.Fatal(err)
	}
	if plan.RoutedEngine != "structure" {
		t.Errorf("expected smart engine to route json to structure, got: %s", plan.RoutedEngine)
	}

	ctxLog := &optimizer.OptimizationContext{
		Goal:        "balanced",
		ContentType: "log",
		Profile:     optimizer.CompressionProfile{Name: "balanced", TargetRatio: 0.60},
	}
	planLog, err := plannerObj.Plan(ctxLog, "auto", nil)
	if err != nil {
		t.Fatal(err)
	}
	if planLog.RoutedEngine != "tool" {
		t.Errorf("expected smart engine to route logs to tool, got: %s", planLog.RoutedEngine)
	}
}

func TestPipelineRunnerRollback(t *testing.T) {
	origMessages := []interface{}{
		map[string]interface{}{"role": "user", "content": "this is short"},
	}

	ctx := &optimizer.OptimizationContext{
		Context:         context.Background(),
		Messages:        origMessages,
		Goal:            "balanced",
		EstimatedTokens: 5,
		Profile:         optimizer.CompressionProfile{Name: "balanced", TargetRatio: 0.60},
	}

	plannerObj := planner.NewPlanner()
	plan, err := plannerObj.Plan(ctx, "fusion", nil)
	if err != nil {
		t.Fatal(err)
	}

	runnerObj := runner.NewRunner()
	res, err := runnerObj.Run(ctx, plan)
	if err != nil {
		t.Fatal(err)
	}

	if len(res.Messages) != 1 {
		t.Fatal("expected 1 message in output")
	}
	content := res.Messages[0].(map[string]interface{})["content"].(string)
	if content != "this is short" {
		t.Errorf("expected prompt content to be preserved, got: %s", content)
	}
}

func TestHeadroomJSONCompression(t *testing.T) {
	largeJSON := `{"name":"test","data":"some very long text that exceeds the fifty characters threshold and should be compressed by the fallback compressor, and we write it even longer to exceed the 200 characters limit required by the headroom pass to run compression otherwise it skips it, so we repeat this message to be long enough!"}`
	ctx := &optimizer.OptimizationContext{
		Context:         context.Background(),
		Messages:        []interface{}{
			map[string]interface{}{"role": "user", "content": largeJSON},
			map[string]interface{}{"role": "user", "content": "analyze the JSON above"},
		},
		Goal:            "balanced",
		EstimatedTokens: 100,
		HasJSON:         true,
		ContentType:     "json",
		Profile:         optimizer.CompressionProfile{Name: "balanced", TargetRatio: 0.60},
	}

	plannerObj := planner.NewPlanner()
	plan, err := plannerObj.Plan(ctx, "structure", nil)
	if err != nil {
		t.Fatal(err)
	}

	runnerObj := runner.NewRunner()
	res, err := runnerObj.Run(ctx, plan)
	if err != nil {
		t.Fatal(err)
	}

	if len(res.Messages) == 0 {
		t.Fatal("expected output messages")
	}
	outContent := res.Messages[0].(map[string]interface{})["content"].(string)
	
	if !TestingStringContains(outContent, `"name"`) || !TestingStringContains(outContent, `"data"`) || !TestingStringContains(outContent, `"test"`) {
		t.Errorf("JSON structural layout violated: %s", outContent)
	}
	
	if !TestingStringContains(outContent, "...[compressed]...") {
		t.Errorf("JSON long string value not compressed: %s", outContent)
	}
}

func TestCodeBlockCompression(t *testing.T) {
	promptWithBlocks := "Instruction:\n" +
		"Please check my logs:\n" +
		"```text\n" +
		"2026-07-19 INFO: system started successfully and it is very stable\n" +
		"2026-07-19 INFO: loaded provider configs\n" +
		"2026-07-19 INFO: routing active request 1\n" +
		"2026-07-19 INFO: routing active request 2\n" +
		"2026-07-19 INFO: routing active request 3\n" +
		"2026-07-19 INFO: routing active request 4\n" +
		"2026-07-19 INFO: routing active request 5\n" +
		"2026-07-19 INFO: routing active request 6\n" +
		"2026-07-19 INFO: routing active request 7\n" +
		"2026-07-19 INFO: routing active request 8\n" +
		"2026-07-19 INFO: routing active request 9\n" +
		"2026-07-19 INFO: routing active request 10\n" +
		"```\n" +
		"And tell me if everything looks fine."

	ctx := &optimizer.OptimizationContext{
		Context:         context.Background(),
		Messages:        []interface{}{
			map[string]interface{}{"role": "user", "content": promptWithBlocks},
		},
		Goal:            "balanced",
		EstimatedTokens: 200,
		Profile:         optimizer.CompressionProfile{Name: "extreme", TargetRatio: 0.20},
	}

	plannerObj := planner.NewPlanner()
	plan, err := plannerObj.Plan(ctx, "structure", nil)
	if err != nil {
		t.Fatal(err)
	}

	runnerObj := runner.NewRunner()
	res, err := runnerObj.Run(ctx, plan)
	if err != nil {
		t.Fatal(err)
	}

	outContent := res.Messages[0].(map[string]interface{})["content"].(string)

	if !TestingStringContains(outContent, "Instruction:") || !TestingStringContains(outContent, "looks fine.") {
		t.Errorf("natural language instructions were corrupted: %s", outContent)
	}

	if !TestingStringContains(outContent, "...[compressed]...") {
		t.Errorf("expected inner logs code block to be middle truncated, but got: %s", outContent)
	}
}

func TestingStringContains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
