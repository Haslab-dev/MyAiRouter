import { useState, useEffect } from 'react';

export default function TracesPage() {
  const [traces, setTraces] = useState([]);
  const [selectedTrace, setSelectedTrace] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTraces = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/traces?limit=100');
      if (res.ok) {
        const data = await res.json();
        setTraces(data || []);
      }
    } catch (err) {
      console.error('Error fetching traces:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTraces();
    const interval = setInterval(fetchTraces, 10000);
    return () => clearInterval(interval);
  }, []);

  const selectTrace = async (id) => {
    try {
      const res = await fetch(`/api/traces/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedTrace(data);
      }
    } catch (err) {
      console.error('Error fetching trace detail:', err);
    }
  };

  const filteredTraces = traces.filter(t => 
    t.model.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.provider.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Request Traces</h1>
          <p className="page-description">High-fidelity execution traces tracking request lifecycle and latency timeline.</p>
        </div>
        <button className="btn btn-secondary" onClick={fetchTraces}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>refresh</span>
          Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedTrace ? '350px 1fr' : '1fr', gap: '20px', transition: 'all 0.3s ease' }}>
        
        {/* Left Column: Traces List */}
        <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', overflowY: 'auto' }}>
          <div style={{ marginBottom: '16px' }}>
            <input 
              type="text" 
              placeholder="Search by ID, provider, model..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field" 
              style={{ fontSize: '12px', padding: '8px 12px' }}
            />
          </div>

          {isLoading && traces.length === 0 ? (
            <div style={{ display: 'flex', flexGrow: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              Loading traces...
            </div>
          ) : filteredTraces.length === 0 ? (
            <div style={{ display: 'flex', flexGrow: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              No traces found
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredTraces.map((t) => {
                let parsed = {};
                try {
                  parsed = JSON.parse(t.data);
                } catch(e){}

                const isError = t.status === 'error';
                const latency = parsed.latencyMs !== undefined ? `${parsed.latencyMs}ms` : 'N/A';
                const cost = parsed.cost !== undefined ? `$${parsed.cost.toFixed(5)}` : '$0';

                return (
                  <div 
                    key={t.id} 
                    onClick={() => selectTrace(t.id)}
                    style={{
                      padding: '12px',
                      borderRadius: 'var(--radius-md)',
                      background: selectedTrace?.requestId === t.id ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.01)',
                      border: selectedTrace?.requestId === t.id ? '1px solid var(--color-primary)' : '1px solid var(--border-color)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    className="trace-item-card"
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        {t.id.slice(0, 8)}...
                      </span>
                      <span className={`badge ${isError ? 'badge-danger' : 'badge-success'}`} style={{ fontSize: '9px', padding: '2px 6px' }}>
                        {t.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.model}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
                      <span>{t.provider.toUpperCase()}</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{latency} · {cost}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Selected Trace Detail */}
        {selectedTrace && (
          <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '20px' }}>
              <div>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--color-primary)', fontWeight: '600' }}>
                  Request Context Details
                </span>
                <h2 style={{ fontSize: '18px', fontWeight: '700', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                  {selectedTrace.requestId}
                </h2>
              </div>
              <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setSelectedTrace(null)}>
                Close Detail
              </button>
            </div>

            {/* KPI Metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '24px' }}>
              <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Status</div>
                <div style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px', color: selectedTrace.status === 'ok' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {selectedTrace.status === 'ok' ? 'Success' : 'Error'}
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Latency</div>
                <div style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                  {selectedTrace.latencyMs}ms
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>TTFB</div>
                <div style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                  {selectedTrace.ttfbMs || 0}ms
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Cost</div>
                <div style={{ fontSize: '15px', fontWeight: '700', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                  ${selectedTrace.cost?.toFixed(5)}
                </div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Tokens (P/C/Cached)</div>
                <div style={{ fontSize: '12px', fontWeight: '700', marginTop: '6px', fontFamily: 'var(--font-mono)' }}>
                  {selectedTrace.promptTokens} / {selectedTrace.completionTokens} / {selectedTrace.cachedTokens || 0}
                </div>
              </div>
            </div>

            {/* Error stack if present */}
            {selectedTrace.errors && selectedTrace.errors.length > 0 && (
              <div style={{ background: 'rgba(255,90,103,0.06)', border: '1px solid rgba(255,90,103,0.2)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '24px' }}>
                <h4 style={{ color: 'var(--color-danger)', fontSize: '13px', fontWeight: '700', marginBottom: '8px' }}>
                  Execution Errors
                </h4>
                <ul style={{ fontSize: '12px', paddingLeft: '16px', lineHeight: '1.6' }}>
                  {selectedTrace.errors.map((e, idx) => (
                    <li key={idx} style={{ color: 'rgba(255,255,255,0.85)' }}>{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Step-by-Step Trace Timeline */}
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Pipeline Execution Steps
              </h3>

              <div style={{ position: 'relative', paddingLeft: '24px' }}>
                <div style={{ position: 'absolute', left: '7px', top: '8px', bottom: '8px', width: '2px', background: 'var(--border-color)' }}></div>
                
                {selectedTrace.steps?.map((step, idx) => {
                  const isErr = step.status === 'failed';
                  const isSuccess = step.status === 'success';

                  return (
                    <div key={idx} style={{ position: 'relative', marginBottom: '16px' }}>
                      <div 
                        style={{ 
                          position: 'absolute', 
                          left: '-23px', 
                          top: '4px', 
                          width: '12px', 
                          height: '12px', 
                          borderRadius: '50%', 
                          background: isErr ? 'var(--color-danger)' : isSuccess ? 'var(--color-success)' : 'var(--text-subtle)',
                          border: '3px solid var(--bg-card)',
                          boxShadow: isSuccess ? '0 0 8px rgba(46,204,113,0.4)' : 'none'
                        }}
                      ></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: '600' }}>{step.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{step.details}</div>
                        </div>
                        <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-subtle)' }}>
                          +{step.durationMs}ms
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Raw Trace Payload */}
            <div>
              <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Raw Telemetry Payload
              </h3>
              <pre style={{
                background: 'rgba(0,0,0,0.2)',
                border: '1px solid var(--border-color)',
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                fontSize: '11px',
                color: 'var(--text-main)',
                fontFamily: 'var(--font-mono)',
                maxHeight: '300px',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}>
                {JSON.stringify(selectedTrace, null, 2)}
              </pre>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
