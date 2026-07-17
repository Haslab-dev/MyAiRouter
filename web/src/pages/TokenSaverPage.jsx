import { useState, useEffect } from 'react';

export default function TokenSaverPage() {
  const [rtkEnabled, setRtkEnabled] = useState(true);
  const [headroomEnabled, setHeadroomEnabled] = useState(false);
  const [headroomUrl, setHeadroomUrl] = useState('http://localhost:8787');
  
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState('full');
  
  const [ponytailEnabled, setPonytailEnabled] = useState(false);
  const [ponytailLevel, setPonytailLevel] = useState('full');

  useEffect(() => {
    // Fetch current settings
    const fetchSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          setRtkEnabled(data.rtkEnabled);
          setHeadroomEnabled(data.headroomEnabled);
          setHeadroomUrl(data.headroomUrl || 'http://localhost:8787');
          setCavemanEnabled(data.cavemanEnabled);
          setCavemanLevel(data.cavemanLevel || 'full');
          setPonytailEnabled(data.ponytailEnabled);
          setPonytailLevel(data.ponytailLevel || 'full');
        }
      } catch (err) {
        console.error('Error fetching settings:', err);
      }
    };
    fetchSettings();
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
        setRtkEnabled(data.rtkEnabled);
        setHeadroomEnabled(data.headroomEnabled);
        setHeadroomUrl(data.headroomUrl);
        setCavemanEnabled(data.cavemanEnabled);
        setCavemanLevel(data.cavemanLevel);
        setPonytailEnabled(data.ponytailEnabled);
        setPonytailLevel(data.ponytailLevel);
      }
    } catch (err) {
      console.error('Error patching settings:', err);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Token Saver Options</h1>
          <p className="page-description">Optimize prompt context and LLM outputs to significantly reduce API costs.</p>
        </div>
      </div>

      {/* 1. RTK Bolt Tool Output Saver */}
      <div className="card">
        <div className="toggle-wrapper">
          <div className="toggle-info">
            <h3 className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined text-primary">bolt</span>
              Bolt Tool Output Compression (RTK)
            </h3>
            <p className="toggle-desc">
              Automatically intercepts and strips empty logs and redundant fields from tool payloads 
              (<code>git diff</code>, <code>git log</code>, <code>ls -la</code>, <code>tree</code>, <code>grep</code>) before sending to LLM. Saves 60-90% input tokens.
            </p>
          </div>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={rtkEnabled} 
              onChange={() => patchSetting({ rtkEnabled: !rtkEnabled })}
            />
            <span className="slider"></span>
          </label>
        </div>
      </div>

      {/* 2. Headroom Context Compressor */}
      <div className="card">
        <div className="toggle-wrapper" style={{ borderBottom: headroomEnabled ? '1px solid var(--border-color)' : 'none', paddingBottom: headroomEnabled ? '20px' : '16px' }}>
          <div className="toggle-info">
            <h3 className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined text-primary">compress</span>
              Headroom Context Pre-check
            </h3>
            <p className="toggle-desc">
              Routes prompt messages through a local Headroom compression server at <code>/v1/compress</code> before querying the primary LLM.
            </p>
          </div>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={headroomEnabled} 
              onChange={() => patchSetting({ headroomEnabled: !headroomEnabled })}
            />
            <span className="slider"></span>
          </label>
        </div>

        {headroomEnabled && (
          <div style={{ marginTop: '20px' }}>
            <label className="form-label">Headroom Service URL</label>
            <div style={{ display: 'flex', gap: '12px' }}>
              <input 
                type="text" 
                value={headroomUrl} 
                onChange={(e) => setHeadroomUrl(e.target.value)}
                className="input-field" 
                style={{ maxWidth: '400px' }}
              />
              <button 
                onClick={() => patchSetting({ headroomUrl })}
                className="btn btn-secondary"
              >
                Update URL
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Caveman Output Compressor */}
      <div className="card">
        <div className="toggle-wrapper" style={{ borderBottom: cavemanEnabled ? '1px solid var(--border-color)' : 'none', paddingBottom: cavemanEnabled ? '20px' : '16px' }}>
          <div className="toggle-info">
            <h3 className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined text-primary">record_voice_over</span>
              Caveman Output Compression
            </h3>
            <p className="toggle-desc">
              Injects terse grammatical directives into the system instructions to force the LLM to skip conversational fluff and hedging.
            </p>
          </div>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={cavemanEnabled} 
              onChange={() => patchSetting({ cavemanEnabled: !cavemanEnabled })}
            />
            <span className="slider"></span>
          </label>
        </div>

        {cavemanEnabled && (
          <div style={{ marginTop: '20px' }}>
            <label className="form-label">Caveman Intensity Level</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['lite', 'full', 'ultra'].map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => patchSetting({ cavemanLevel: lvl })}
                  className={`btn ${cavemanLevel === lvl ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ textTransform: 'capitalize', padding: '8px 16px', fontSize: '12px' }}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <p className="toggle-desc" style={{ marginTop: '8px' }}>
              {cavemanLevel === 'lite' && 'Lite: Drops conversational hedging and filler while maintaining clean full sentences.'}
              {cavemanLevel === 'full' && 'Full: Terse caveman style. Drops articles (the, a), hedging, and pleasantries. Fragments OK.'}
              {cavemanLevel === 'ultra' && 'Ultra: Maximum telegraphic compression. Strips conjunctions, returning code blocks and minimal keywords.'}
            </p>
          </div>
        )}
      </div>

      {/* 4. Ponytail Developer Persona */}
      <div className="card">
        <div className="toggle-wrapper" style={{ borderBottom: ponytailEnabled ? '1px solid var(--border-color)' : 'none', paddingBottom: ponytailEnabled ? '20px' : '16px' }}>
          <div className="toggle-info">
            <h3 className="toggle-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="material-symbols-outlined text-primary">code</span>
              Lazy Senior Dev (Ponytail)
            </h3>
            <p className="toggle-desc">
              Biases the LLM to write minimal code. Enforces YAGNI (You Aren't Gonna Need It), standard library first, native platforms, and deletion over addition.
            </p>
          </div>
          <label className="switch">
            <input 
              type="checkbox" 
              checked={ponytailEnabled} 
              onChange={() => patchSetting({ ponytailEnabled: !ponytailEnabled })}
            />
            <span className="slider"></span>
          </label>
        </div>

        {ponytailEnabled && (
          <div style={{ marginTop: '20px' }}>
            <label className="form-label">Ponytail Bias Level</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['lite', 'full', 'ultra'].map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => patchSetting({ ponytailLevel: lvl })}
                  className={`btn ${ponytailLevel === lvl ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ textTransform: 'capitalize', padding: '8px 16px', fontSize: '12px' }}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <p className="toggle-desc" style={{ marginTop: '8px' }}>
              {ponytailLevel === 'lite' && 'Lite: Builds what was asked, but reports a simpler alternative. User decides.'}
              {ponytailLevel === 'full' && 'Full: Enforces standard libraries. Prefers minimal diffs and minimal dependencies.'}
              {ponytailLevel === 'ultra' && 'Ultra: Extreme YAGNI. Deletes code rather than writing new functions, challenges requirements.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
