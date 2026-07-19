import { useState, useEffect } from 'react';

export default function TokenSaverPage() {
  const [activeTab, setActiveTab] = useState('settings');

  // Optimizer Settings State
  const [optimizerEnabled, setOptimizerEnabled] = useState(true);
  const [optimizationEngine, setOptimizationEngine] = useState('auto');
  const [optimizationProfile, setOptimizationProfile] = useState('balanced');
  const [optimizationGoal, setOptimizationGoal] = useState('balanced');
  const [pipelineSteps, setPipelineSteps] = useState([]);
  const [traceStorageMode, setTraceStorageMode] = useState('store_both');
  const [engines, setEngines] = useState({});

  // Playground State
  const [playgroundPrompt, setPlaygroundPrompt] = useState('');
  const [playgroundResult, setPlaygroundResult] = useState(null);
  const [playgroundLoading, setPlaygroundLoading] = useState(false);

  // Benchmarks State
  const [benchmarkResults, setBenchmarkResults] = useState(null);
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkCategory, setBenchmarkCategory] = useState('all');

  useEffect(() => {
    const loadInitData = async () => {
      try {
        const settingsRes = await fetch('/api/settings');
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          setOptimizerEnabled(data.optimizerEnabled);
          setOptimizationEngine(data.optimizationEngine || 'auto');
          setOptimizationProfile(data.optimizationProfile || 'balanced');
          setOptimizationGoal(data.optimizationGoal || 'balanced');
          setPipelineSteps(data.pipelineSteps || []);
          setTraceStorageMode(data.traceStorageMode || 'store_both');
        }

        const enginesRes = await fetch('/api/optimizer/engines');
        if (enginesRes.ok) {
          const data = await enginesRes.json();
          setEngines(data);
        }
      } catch (err) {
        console.error('Error loading initialization data:', err);
      }
    };

    loadInitData();
  }, []);

  const patchSetting = async (update) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (res.ok) {
        const data = await res.json();
        setOptimizerEnabled(data.optimizerEnabled);
        setOptimizationEngine(data.optimizationEngine);
        setOptimizationProfile(data.optimizationProfile);
        setOptimizationGoal(data.optimizationGoal);
        setPipelineSteps(data.pipelineSteps);
        setTraceStorageMode(data.traceStorageMode);
      }
    } catch (err) {
      console.error('Error saving settings:', err);
    }
  };

  const handleToggleStep = (stepName) => {
    const updated = pipelineSteps.map(s => 
      s.name === stepName ? { ...s, enabled: !s.enabled } : s
    );
    setPipelineSteps(updated);
    patchSetting({ pipelineSteps: updated });
  };

  const handleRunPlayground = async () => {
    if (!playgroundPrompt.trim()) return;
    setPlaygroundLoading(true);
    setPlaygroundResult(null);
    try {
      const res = await fetch('/api/optimizer/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: playgroundPrompt,
          engine: optimizationEngine,
          power: optimizationProfile,
          goal: optimizationGoal,
          pipelineSteps: pipelineSteps,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPlaygroundResult(data);
      }
    } catch (err) {
      console.error('Error running playground preview:', err);
    } finally {
      setPlaygroundLoading(false);
    }
  };

  const handleRunBenchmark = async () => {
    setBenchmarkLoading(true);
    setBenchmarkResults(null);
    try {
      const res = await fetch('/api/optimizer/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        setBenchmarkResults(data);
      }
    } catch (err) {
      console.error('Error running replay benchmark:', err);
    } finally {
      setBenchmarkLoading(false);
    }
  };

  const getPassDescription = (action) => {
    if (!action || !action.details) return '';
    const details = action.details;
    switch (action.action) {
      case 'formatted_tool_outputs':
        return `Stripped raw headers/logs, formatting messages (Saved ${details.bytesSaved || 0} bytes)`;
      case 'optimized_markdown':
        return `Pruned spacing, removed ${details.commentsStripped || 0} comment bytes, and collapsed ${details.linesCollapsed || 0} blank newlines`;
      case 'collapsed_duplicates':
        return `Deduplicated CLI output lines, collapsing repeating rows (Saved ${details.bytesSaved || 0} bytes)`;
      case 'structure_preservation':
        return `Structure-preserved JSON fields and code AST variables (Compressed ${details.compressedBlocks || 0} value spans)`;
      case 'validation_failed':
        return `Validation failed! Reason: ${details.error || 'Unknown error'}`;
      case 'validation_succeeded':
        return `Mandatory structural validation check passed successfully.`;
      case 'rollback':
        return `Reverted pass changes because criteria was violated: ${details.message || ''}`;
      default:
        return action.action;
    }
  };

  return (
    <div style={{ paddingBottom: '40px' }}>
      <div className="page-header" style={{ marginBottom: '24px' }}>
        <div>
          <h1 className="page-title">Prompt Optimizer Control Center</h1>
          <p className="page-description">LLVM-inspired prompt optimizer pipeline providing content analysis, smart engine routing, safety verification, and traffic telemetry replays.</p>
        </div>
      </div>

      {/* Tabs Menu */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '24px', gap: '8px' }}>
        {['settings', 'playground', 'benchmark'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`btn ${activeTab === tab ? 'btn-primary' : 'btn-secondary'}`}
            style={{ 
              textTransform: 'capitalize', 
              borderBottomLeftRadius: 0, 
              borderBottomRightRadius: 0,
              padding: '10px 20px',
              fontSize: '13px',
              boxShadow: activeTab === tab ? 'var(--glow-primary)' : 'none'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px', marginRight: '6px', verticalAlign: 'middle' }}>
              {tab === 'settings' ? 'settings' : tab === 'playground' ? 'sports_esports' : 'analytics'}
            </span>
            <span style={{ verticalAlign: 'middle' }}>{tab}</span>
          </button>
        ))}
      </div>

      {activeTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Main Enable Option */}
          <div className="card" style={{ borderLeft: '3px solid var(--color-primary)' }}>
            <div className="toggle-wrapper">
              <div className="toggle-info">
                <h3 className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="material-symbols-outlined text-primary">power_settings_new</span>
                  Enable Prompt Optimizer
                </h3>
                <p className="toggle-desc">
                  Optimizes context token volume, runs structure preservation, formats output lists, and runs mandatory safety validation before routing to target models.
                </p>
              </div>
              <label className="switch">
                <input 
                  type="checkbox" 
                  checked={optimizerEnabled} 
                  onChange={() => patchSetting({ optimizerEnabled: !optimizerEnabled })}
                />
                <span className="slider"></span>
              </label>
            </div>
          </div>

          {optimizerEnabled && (
            <>
              {/* Goal Cards */}
              <div className="card">
                <h3 className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <span className="material-symbols-outlined text-primary">target</span>
                  Optimization Goal
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                  {[
                    { id: 'accuracy', name: 'Maximum Accuracy', desc: 'Preserves original tokens for high-precision scenarios, skips lossy compression.' },
                    { id: 'balanced', name: 'Balanced', desc: 'Equal parts token savings and signature preservation.' },
                    { id: 'savings', name: 'Token Savings', desc: 'Maximum compression using deduplication and markdown cleanup.' },
                    { id: 'speed', name: 'Fastest Speed', desc: 'Runs only fast deterministic passes (Tool output formats) to minimize latency.' },
                    { id: 'cost', name: 'Lowest Cost', desc: 'Compresses aggressively to minimize provider billing.' },
                  ].map(goal => (
                    <div 
                      key={goal.id}
                      onClick={() => patchSetting({ optimizationGoal: goal.id })}
                      style={{
                        padding: '16px',
                        borderRadius: 'var(--radius-md)',
                        background: optimizationGoal === goal.id ? 'rgba(0, 200, 255, 0.08)' : 'var(--bg-surface)',
                        border: `1px solid ${optimizationGoal === goal.id ? 'var(--color-primary)' : 'var(--border-color)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-main)', marginBottom: '6px' }}>{goal.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>{goal.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Power Level Cards */}
              <div className="card">
                <h3 className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <span className="material-symbols-outlined text-primary">speed</span>
                  Optimization Profile
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                  {[
                    { id: 'lite', name: 'Lite', desc: 'Safe targets (Keep ~85% of tokens)' },
                    { id: 'balanced', name: 'Balanced', desc: 'Optimized mix (Keep ~60% of tokens)' },
                    { id: 'aggressive', name: 'Aggressive', desc: 'Deep pruning (Keep ~40% of tokens)' },
                    { id: 'extreme', name: 'Extreme', desc: 'Telegraphic limits (Keep ~20% of tokens)' },
                  ].map(power => (
                    <div 
                      key={power.id}
                      onClick={() => patchSetting({ optimizationProfile: power.id })}
                      style={{
                        padding: '16px',
                        borderRadius: 'var(--radius-md)',
                        background: optimizationProfile === power.id ? 'rgba(0, 200, 255, 0.08)' : 'var(--bg-surface)',
                        border: `1px solid ${optimizationProfile === power.id ? 'var(--color-primary)' : 'var(--border-color)'}`,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-main)', marginBottom: '6px' }}>{power.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>{power.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Engines Registry */}
              <div className="card">
                <h3 className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <span className="material-symbols-outlined text-primary">settings_input_component</span>
                  Optimization Engine
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {Object.keys(engines).map(key => {
                    const engine = engines[key];
                    // Handle map key matching
                    const engineId = engine.id || engine.name.toLowerCase().split(' ')[0];
                    const isSelected = optimizationEngine === engineId;
                    return (
                      <div
                        key={engineId}
                        onClick={() => patchSetting({ optimizationEngine: engineId })}
                        style={{
                          padding: '16px',
                          borderRadius: 'var(--radius-md)',
                          background: isSelected ? 'rgba(0, 200, 255, 0.04)' : 'transparent',
                          border: `1px solid ${isSelected ? 'var(--color-primary)' : 'var(--border-color)'}`,
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                              <span style={{ fontWeight: 750, fontSize: '14px', textTransform: 'capitalize', color: 'var(--text-main)' }}>
                                {engineId === 'auto' ? 'Auto (Recommended)' : engineId === 'tool' ? 'Tool Outputs Formatter' : engineId === 'structure' ? 'Structure Preserver' : 'Fusion Pipeline'}
                              </span>
                              <span style={{ fontSize: '10px', background: 'var(--border-color)', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: '4px' }}>
                                Speed: {engine.estimatedSpeed}
                              </span>
                            </div>
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{engine.description}</p>
                          </div>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            {engine.capabilities.supportsJson && <span style={{ fontSize: '9px', background: 'rgba(46, 204, 113, 0.1)', color: 'var(--color-success)', padding: '2px 6px', borderRadius: '4px' }}>JSON</span>}
                            {engine.capabilities.supportsCode && <span style={{ fontSize: '9px', background: 'rgba(0, 200, 255, 0.1)', color: 'var(--color-primary)', padding: '2px 6px', borderRadius: '4px' }}>Code</span>}
                            {engine.capabilities.supportsLogs && <span style={{ fontSize: '9px', background: 'rgba(245, 176, 65, 0.1)', color: 'var(--color-warning)', padding: '2px 6px', borderRadius: '4px' }}>Logs</span>}
                          </div>
                        </div>

                        {/* References / Inspired By list */}
                        {engine.references && engine.references.length > 0 && (
                          <div style={{ marginTop: '4px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px' }}>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>INSPIRED BY:</div>
                            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '11px', color: 'var(--text-muted)' }}>
                              {engine.references.map((ref, idx) => (
                                <li key={idx}>
                                  <span style={{ color: 'var(--color-primary)', fontWeight: 500 }}>{ref.name}</span> &ndash; {ref.description}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Optimization Pipeline Customization */}
              <div className="card">
                <h3 className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span className="material-symbols-outlined text-primary">view_week</span>
                  Optimization Pipeline
                </h3>
                <p className="toggle-desc" style={{ marginBottom: '16px' }}>Configure which modular passes run in the optimizer pipeline (Validators verify safety and run automatically at the end).</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {pipelineSteps.map(step => {
                    const mappedName = step.name === 'rtk' ? 'tool' : step.name === 'headroom' ? 'structure' : step.name;
                    return (
                      <div 
                        key={step.name}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px 16px',
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-md)',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{mappedName} Pass</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            {mappedName === 'tool' && 'Format console total listings, truncate unified diffs, collapse Author/Date logs.'}
                            {mappedName === 'structure' && 'JSON array item index limits, code signature scanners, high-entropy key checks.'}
                            {mappedName === 'dedup' && 'Collapses duplicate log or terminal lines with pattern matching.'}
                            {mappedName === 'markdown' && 'Collapse 3+ empty newlines to 2, trim line-ends, strip HTML comment blocks.'}
                          </div>
                        </div>
                        <label className="switch">
                          <input 
                            type="checkbox" 
                            checked={step.enabled} 
                            onChange={() => handleToggleStep(step.name)}
                          />
                          <span className="slider"></span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Privacy / Telemetry Storage Mode */}
              <div className="card">
                <h3 className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <span className="material-symbols-outlined text-primary">visibility</span>
                  Trace Storage Privacy
                </h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { id: 'disabled', label: 'Disabled', desc: 'No logs' },
                    { id: 'metadata_only', label: 'Metadata Only', desc: 'Tokens & Latency' },
                    { id: 'store_both', label: 'Store Telemetry (Replay)', desc: 'Store prompts for Benchmark replays' },
                  ].map(mode => (
                    <button
                      key={mode.id}
                      onClick={() => patchSetting({ traceStorageMode: mode.id })}
                      className={`btn ${traceStorageMode === mode.id ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ flex: 1, padding: '12px', fontSize: '12px' }}
                    >
                      <div style={{ fontWeight: 600 }}>{mode.label}</div>
                      <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '2px' }}>{mode.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* About Section */}
              <div className="card" style={{ borderTop: '1px solid var(--border-color)', marginTop: '12px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: '18px' }}>info</span>
                  Research & Inspiration Acknowledgments
                </h4>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5', margin: '0 0 10px 0' }}>
                  This optimizer is an original implementation written in Go, inspired by the following projects:
                </p>
                <ul style={{ margin: '0 0 10px 0', paddingLeft: '20px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                  <li><strong>LLVM:</strong> Influenced the pass manager design, pipeline validation layers, and topological sorting rules.</li>
                  <li><strong>Headroom:</strong> Influenced structure-preserving regex scanners and high-entropy key masks.</li>
                  <li><strong>RTK Bolt:</strong> Influenced deterministic console tool logs formatting regex patterns.</li>
                  <li><strong>LLMLingua:</strong> Inspired semantic context pruning concepts.</li>
                </ul>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
                  No source code from these projects is included unless explicitly stated.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'playground' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card">
            <h3 className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span className="material-symbols-outlined text-primary">terminal</span>
              Interactive Optimizer Playground
            </h3>
            <p className="toggle-desc" style={{ marginBottom: '16px' }}>Paste a sample prompt payload below (JSON structures, source code, or command outputs) to analyze the real-time pipeline compile pass results.</p>
            
            <textarea
              className="input-field"
              rows="8"
              value={playgroundPrompt}
              onChange={(e) => setPlaygroundPrompt(e.target.value)}
              placeholder="Paste test JSON, code blocks, or raw log files here..."
              style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: '12px', padding: '12px', marginBottom: '16px', background: 'var(--bg-color)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}
            />

            <button
              onClick={handleRunPlayground}
              disabled={playgroundLoading || !playgroundPrompt.trim()}
              className="btn btn-primary"
              style={{ padding: '10px 24px', fontSize: '13px' }}
            >
              {playgroundLoading ? 'Running optimization steps...' : 'Analyze & Optimize Prompt'}
            </button>
          </div>

          {playgroundResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Telemetry Stats */}
              <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '16px', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Original Tokens</div>
                  <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px', fontFamily: 'var(--font-mono)' }}>{playgroundResult.before.tokens}</div>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Optimized Tokens</div>
                  <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px', fontFamily: 'var(--font-mono)', color: 'var(--color-primary)' }}>{playgroundResult.after.tokens}</div>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tokens Saved</div>
                  <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px', fontFamily: 'var(--font-mono)', color: 'var(--color-success)' }}>
                    {playgroundResult.before.tokens > 0 
                      ? (((playgroundResult.before.tokens - playgroundResult.after.tokens) / playgroundResult.before.tokens) * 100).toFixed(0) 
                      : 0}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Compile Duration</div>
                  <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                    {Math.round(playgroundResult.report.duration / 1000000)}ms
                  </div>
                </div>
              </div>

              {/* DevTools Explain Panel */}
              <div className="card">
                <h4 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: '18px' }}>list_alt</span>
                  DevTools Pass Breakdown
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  
                  {/* Planner sniffer logs */}
                  {playgroundResult.plan.plannerLogs && playgroundResult.plan.plannerLogs.map((logLine, idx) => (
                    <div key={`plan-${idx}`} style={{ padding: '8px 12px', background: 'rgba(0,200,255,0.02)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', fontSize: '12px', color: 'var(--text-muted)' }}>
                      <strong style={{ color: 'var(--color-primary)' }}>Planner &gt;</strong> {logLine}
                    </div>
                  ))}

                  {/* Pass stats */}
                  {playgroundResult.report.explainLog && playgroundResult.report.explainLog.map((action, i) => (
                    <div 
                      key={i}
                      style={{ 
                        padding: '12px', 
                        borderRadius: 'var(--radius-sm)', 
                        background: 'rgba(255,255,255,0.01)', 
                        border: '1px solid var(--border-color)',
                        borderLeft: action.action.includes('fail') ? '3px solid var(--color-danger)' : '3px solid var(--color-success)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{action.pass} Pass</span>
                        <span style={{ fontSize: '9px', background: 'var(--border-color)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-muted)' }}>
                          {action.action}
                        </span>
                      </div>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{getPassDescription(action)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Side-by-side prompt diffs */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div className="card">
                  <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>Original Prompt</h4>
                  <pre style={{ margin: 0, padding: '12px', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', overflowX: 'auto', fontSize: '11px', fontFamily: 'var(--font-mono)', maxHeight: '350px', whiteSpace: 'pre-wrap' }}>
                    {playgroundResult.before.prompt}
                  </pre>
                </div>
                <div className="card">
                  <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--color-primary)', marginBottom: '8px' }}>Optimized Prompt Output</h4>
                  <pre style={{ margin: 0, padding: '12px', background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', overflowX: 'auto', fontSize: '11px', fontFamily: 'var(--font-mono)', maxHeight: '350px', whiteSpace: 'pre-wrap' }}>
                    {playgroundResult.after.prompt}
                  </pre>
                </div>
              </div>

            </div>
          )}
        </div>
      )}

      {activeTab === 'benchmark' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card">
            <h3 className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span className="material-symbols-outlined text-primary">query_stats</span>
              Real-World Telemetry Benchmark
            </h3>
            <p className="toggle-desc" style={{ marginBottom: '16px' }}>
              Bypasses mock calculations. This task scans up to 100 historical queries stored in the trace logs, replays them locally across all optimizer engines, and renders accurate metrics based on your actual workload.
            </p>
            
            {traceStorageMode === 'disabled' || traceStorageMode === 'metadata_only' ? (
              <div style={{ padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-danger)', background: 'rgba(255,90,103,0.05)', color: 'var(--text-main)', fontSize: '13px' }}>
                <strong>Privacy storage is restricted:</strong> Benchmarks require trace prompt variables. Turn on "Store Telemetry" in settings first.
              </div>
            ) : (
              <button
                onClick={handleRunBenchmark}
                disabled={benchmarkLoading}
                className="btn btn-primary"
                style={{ padding: '10px 24px', fontSize: '13px' }}
              >
                {benchmarkLoading ? 'Running workload replay simulation...' : 'Execute actual traffic benchmark'}
              </button>
            )}
          </div>

          {benchmarkResults && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 600 }}>Comparative Report</h4>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {['all', 'json', 'code', 'log', 'markdown', 'text'].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setBenchmarkCategory(cat)}
                      className={`btn ${benchmarkCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '6px 12px', fontSize: '11px', textTransform: 'uppercase' }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dynamic Table comparison */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <th style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>ENGINE</th>
                      <th style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>SAMPLE SIZE</th>
                      <th style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>AVG SAVINGS</th>
                      <th style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>AVG LATENCY</th>
                      <th style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>STABILITY (SUCCESS)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {['tool', 'structure', 'fusion'].map(engine => {
                      const stats = benchmarkResults[engine] ? benchmarkResults[engine][benchmarkCategory] : null;
                      if (!stats) return null;
                      return (
                        <tr key={engine} style={{ borderBottom: '1px solid var(--border-color)', height: '56px' }}>
                          <td style={{ padding: '12px', fontWeight: 700, textTransform: 'uppercase', fontSize: '13px' }}>
                            {engine === 'tool' ? 'tool formatter' : engine === 'structure' ? 'structure parser' : 'fusion pipeline'} {engine === 'fusion' && '🏆 (Best)'}
                          </td>
                          <td style={{ padding: '12px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>{stats.sampleCount} queries</td>
                          <td style={{ padding: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div style={{ flex: 1, height: '6px', background: 'var(--border-color)', borderRadius: '3px', width: '80px', position: 'relative' }}>
                                <div style={{ height: '100%', borderRadius: '3px', width: `${stats.savings}%`, background: 'var(--color-success)' }}></div>
                              </div>
                              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-success)', fontFamily: 'var(--font-mono)' }}>
                                {stats.savings.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: '12px', fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                            {stats.latencyMs.toFixed(1)} ms
                          </td>
                          <td style={{ padding: '12px', fontSize: '13px', fontFamily: 'var(--font-mono)', color: stats.successRate > 98 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                            {stats.successRate.toFixed(0)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

            </div>
          )}
        </div>
      )}
    </div>
  );
}
