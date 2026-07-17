import { useState, useEffect, useRef, useCallback } from 'react';

export default function UsagePage() {
  const [stats, setStats] = useState({
    totalRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCachedTokens: 0,
    totalCost: 0,
  });
  const [logs, setLogs] = useState([]);
  const [detailedLogs, setDetailedLogs] = useState([]);
  
  // Chart and Table Toggle States
  const [chartViewMode, setChartViewMode] = useState('tokens');
  const [chartData, setChartData] = useState([]);
  
  const [tableViewMode, setTableViewMode] = useState('cost');
  const [tableDropdown, setTableDropdown] = useState('model');
  const [modelSummaries, setModelSummaries] = useState([]);

  const [connections, setConnections] = useState([]);
  const [nodesList, setNodesList] = useState([]);

  // Tree zoom state (no pan)
  const [treeScale, setTreeScale] = useState(1);
  const treeRef = useRef(null);

  const centerTree = useCallback(() => setTreeScale(1), []);

  const zoomIn = () => setTreeScale(s => Math.min(s + 0.2, 3));
  const zoomOut = () => setTreeScale(s => Math.max(s - 0.2, 0.3));

  const handleTreeWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setTreeScale(s => Math.max(0.3, Math.min(3, s + delta)));
  };

  const treeCenterX = 250;
  const treeCenterY = 190;

  const hasTraffic = useCallback((providerId) => {
    return logs.some(l => l.provider === providerId || (l.model && l.model.startsWith(providerId + '/')));
  }, [logs]);

  const fetchData = async () => {
    try {
      // 1. Overall stats
      const statsRes = await fetch('/api/usage/stats');
      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats({
          totalRequests: data.totalRequests || 0,
          totalPromptTokens: data.totalPromptTokens || 0,
          totalCompletionTokens: data.totalCompletionTokens || 0,
          totalCachedTokens: data.totalCachedTokens || 0,
          totalCost: data.totalCost || 0,
        });
      }

      // 2. Recent Logs & Detailed Logs
      const logsRes = await fetch('/api/usage/logs?limit=100');
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.slice(0, 8));
        setDetailedLogs(data);
      }

      // 3. Hourly charts
      const chartRes = await fetch('/api/usage/charts');
      if (chartRes.ok) {
        const data = await chartRes.json();
        setChartData(data || []);
      }

      // 4. Model usage summaries
      const modelRes = await fetch('/api/usage/models');
      if (modelRes.ok) {
        const data = await modelRes.json();
        setModelSummaries(data || []);
      }

      // 5. Providers for tree network
      const [connRes, nodeRes] = await Promise.all([
        fetch('/api/providers'),
        fetch('/api/provider-nodes')
      ]);
      if (connRes.ok) {
        setConnections(await connRes.ok ? await connRes.json() : []);
      }
      if (nodeRes.ok) {
        const data = await nodeRes.json();
        setNodesList(data.nodes || []);
      }
    } catch (err) {
      console.error('Error fetching analytics stats:', err);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  const isProviderActive = (providerId) => {
    return connections.some(c => c.provider === providerId && c.isActive);
  };

  const getDynamicNodes = () => {
    const cx = treeCenterX;
    const cy = treeCenterY;
    const r = 120;
    const base = [];

    const core = [];
    if (isProviderActive('kilocode')) core.push({ id: 'kilocode', name: 'Kilo Code', icon: 'grid_view' });
    if (isProviderActive('opencode-go')) core.push({ id: 'opencode-go', name: 'OpenCode Go', icon: 'terminal' });
    if (isProviderActive('opencode-zen')) core.push({ id: 'opencode-zen', name: 'OpenCode Zen', icon: 'psychology' });
    if (isProviderActive('glm')) core.push({ id: 'glm', name: 'GLM API', icon: 'chat' });
    if (isProviderActive('glm-coding')) core.push({ id: 'glm-coding', name: 'GLM Coding', icon: 'code' });

    core.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(core.length, 1) - Math.PI / 2;
      base.push({ ...n, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), connected: true });
    });

    nodesList.forEach((n, idx) => {
      if (isProviderActive(n.id)) {
        const angle = (2 * Math.PI * idx) / Math.max(nodesList.filter(x => isProviderActive(x.id)).length, 1);
        base.push({
          id: n.id,
          name: n.name,
          x: cx + (r + 60) * Math.cos(angle),
          y: cy + (r + 60) * Math.sin(angle),
          icon: n.type === 'openai-compatible' ? 'api' : 'bubble_chart',
          connected: true
        });
      }
    });

    return base;
  };

  const nodes = getDynamicNodes();

  // Draw pure SVG chart path helper
  const drawChartPath = () => {
    if (chartData.length === 0) return { line: '', area: '' };

    const maxVal = Math.max(...chartData.map(d => chartViewMode === 'tokens' ? d.tokens : d.cost), 1);
    const width = 800;
    const height = 150;
    const padding = 30;

    const points = chartData.map((d, index) => {
      const val = chartViewMode === 'tokens' ? d.tokens : d.cost;
      const x = padding + (index * (width - padding * 2)) / (chartData.length - 1);
      const y = height - padding - (val * (height - padding * 2)) / maxVal;
      return { x, y };
    });

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

    return { line: linePath, area: areaPath, points };
  };

  const { line: linePath, area: areaPath, points: chartPoints } = drawChartPath();
  const maxChartVal = Math.max(...chartData.map(d => chartViewMode === 'tokens' ? d.tokens : d.cost), 1);

  return (
    <div>
      {/* Header bar matching 9router blueprint */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined text-primary" style={{ fontSize: '28px' }}>bar_chart</span>
            Usage & Analytics
          </h1>
          <p className="page-description">Monitor your API usage, token consumption, and request logs</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button className="btn btn-secondary" style={{ background: '#fce7f3', color: '#db2777', borderColor: '#fbcfe8', height: '36px', fontSize: '13px', fontWeight: 600 }}>
            💝 Donate
          </button>
        </div>
      </div>

      {/* 1. Main Timeline Usage Chart widget matching the screenshot */}
      <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-sidebar)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <button 
              onClick={() => setChartViewMode('tokens')} 
              className="btn" 
              style={{
                fontSize: '12px', padding: '4px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                background: chartViewMode === 'tokens' ? 'var(--color-primary)' : 'transparent',
                color: chartViewMode === 'tokens' ? '#fff' : 'var(--text-muted)'
              }}
            >
              Tokens
            </button>
            <button 
              onClick={() => setChartViewMode('cost')} 
              className="btn" 
              style={{
                fontSize: '12px', padding: '4px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                background: chartViewMode === 'cost' ? 'var(--color-primary)' : 'transparent',
                color: chartViewMode === 'cost' ? '#fff' : 'var(--text-muted)'
              }}
            >
              Cost
            </button>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-subtle)' }}>Hourly intervals for the last 24h</div>
        </div>

        {chartData.length === 0 ? (
          <div style={{ height: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)', fontSize: '13px' }}>
            No request data logged in the last 24 hours.
          </div>
        ) : (
          <div style={{ position: 'relative', height: '180px', width: '100%' }}>
            {/* SVG Chart */}
            <svg viewBox="0 0 800 150" width="100%" height="150" style={{ overflow: 'visible' }}>
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              
              {/* Grid Lines */}
              <line x1="30" y1="30" x2="770" y2="30" stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="3 3" />
              <line x1="30" y1="65" x2="770" y2="65" stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="3 3" />
              <line x1="30" y1="100" x2="770" y2="100" stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="3 3" />
              
              {/* Chart Line and Area */}
              {areaPath && <path d={areaPath} fill="url(#chartGrad)" />}
              {linePath && <path d={linePath} fill="none" stroke="var(--color-primary)" strokeWidth="2" />}

              {/* Data points glow */}
              {chartPoints && chartPoints.map((p, idx) => (
                <circle 
                  key={idx} 
                  cx={p.x} 
                  cy={p.y} 
                  r="3" 
                  fill="var(--color-primary)" 
                  style={{ filter: 'drop-shadow(0 0 2px rgba(16,185,129,0.5))' }} 
                />
              ))}
            </svg>

            {/* Time labels axis */}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 30px', fontSize: '10px', color: 'var(--text-subtle)', marginTop: '8px' }}>
              {chartData.map((d, index) => {
                // Show label every 3 hours to avoid crowding
                if (index % 3 === 0 || index === chartData.length - 1) {
                  return <span key={index}>{d.label}</span>;
                }
                return null;
              })}
            </div>
          </div>
        )}
      </div>

      {/* 2. Usage statistics cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <div className="card" style={{ margin: 0, padding: '16px 20px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Total Requests</div>
          <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '8px', color: 'var(--text-main)' }}>{stats.totalRequests}</div>
        </div>

        <div className="card" style={{ margin: 0, padding: '16px 20px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Total Input Tokens</div>
          <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '8px', color: '#ea580c' }}>{stats.totalPromptTokens.toLocaleString()}</div>
        </div>

        <div className="card" style={{ margin: 0, padding: '16px 20px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Cached Tokens</div>
          <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '8px', color: '#2563eb' }}>{stats.totalCachedTokens.toLocaleString()}</div>
        </div>

        <div className="card" style={{ margin: 0, padding: '16px 20px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Output Tokens</div>
          <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '8px', color: 'var(--color-success)' }}>{stats.totalCompletionTokens.toLocaleString()}</div>
        </div>

        <div className="card" style={{ margin: 0, padding: '16px 20px', borderLeft: '3px solid var(--color-warning)' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Est. Cost</div>
          <div style={{ fontSize: '24px', fontWeight: 700, marginTop: '8px', color: '#eab308' }}>~${stats.totalCost.toFixed(4)}</div>
          <div style={{ fontSize: '9px', color: 'var(--text-subtle)', marginTop: '4px' }}>Estimated PaaS rates</div>
        </div>
      </div>

      {/* 3. Detail table usage matching screenshot layout */}
      <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <select 
            value={tableDropdown}
            onChange={(e) => setTableDropdown(e.target.value)}
            className="input-field"
            style={{ width: '200px', height: '36px', fontSize: '13px' }}
          >
            <option value="model">Usage by Model</option>
            <option value="logs">Request Logs</option>
          </select>

          {tableDropdown === 'model' && (
            <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-sidebar)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <button 
                onClick={() => setTableViewMode('cost')} 
                className="btn" 
                style={{
                  fontSize: '12px', padding: '4px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                  background: tableViewMode === 'cost' ? '#ea580c' : 'transparent',
                  color: tableViewMode === 'cost' ? '#fff' : 'var(--text-muted)'
                }}
              >
                Costs
              </button>
              <button 
                onClick={() => setTableViewMode('tokens')} 
                className="btn" 
                style={{
                  fontSize: '12px', padding: '4px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                  background: tableViewMode === 'tokens' ? '#ea580c' : 'transparent',
                  color: tableViewMode === 'tokens' ? '#fff' : 'var(--text-muted)'
                }}
              >
                Tokens
              </button>
            </div>
          )}

          {tableDropdown === 'logs' && (
            <div style={{ fontSize: '12px', color: 'var(--text-subtle)', fontWeight: 600 }}>
              {detailedLogs.length.toLocaleString()} requests
            </div>
          )}
        </div>

        {tableDropdown === 'model' ? (
          modelSummaries.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '13px' }}>
              No request models registered.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-subtle)' }}>
                    <th style={{ padding: '12px' }}>MODEL</th>
                    <th style={{ padding: '12px' }}>PROVIDER</th>
                    <th style={{ padding: '12px' }}>REQUESTS</th>
                    <th style={{ padding: '12px' }}>LAST USED</th>
                    <th style={{ padding: '12px' }}>{tableViewMode === 'cost' ? 'INPUT COST' : 'INPUT TOKENS'}</th>
                    <th style={{ padding: '12px' }}>{tableViewMode === 'cost' ? 'CACHED COST' : 'CACHED TOKENS'}</th>
                    <th style={{ padding: '12px' }}>{tableViewMode === 'cost' ? 'OUTPUT COST' : 'OUTPUT TOKENS'}</th>
                    <th style={{ padding: '12px' }}>{tableViewMode === 'cost' ? 'TOTAL COST' : 'TOTAL TOKENS'}</th>
                  </tr>
                </thead>
                <tbody>
                  {modelSummaries.map((row, index) => {
                    const inputVal = tableViewMode === 'cost' ? `$${(row.cost * 0.4).toFixed(4)}` : row.promptTokens.toLocaleString();
                    const cachedVal = tableViewMode === 'cost' ? `$${(row.cost * 0.1).toFixed(4)}` : (row.cachedTokens || 0).toLocaleString();
                    const outputVal = tableViewMode === 'cost' ? `$${(row.cost * 0.6).toFixed(4)}` : row.completionTokens.toLocaleString();
                    const totalVal = tableViewMode === 'cost' ? `$${row.cost.toFixed(4)}` : (row.promptTokens + row.completionTokens).toLocaleString();

                    return (
                      <tr key={index} style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                        <td style={{ padding: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--text-subtle)' }}>chevron_right</span>
                          {row.model}
                        </td>
                        <td style={{ padding: '12px', color: 'var(--text-subtle)' }}>{row.provider || '—'}</td>
                        <td style={{ padding: '12px' }}>{row.requests}</td>
                        <td style={{ padding: '12px', color: 'var(--text-subtle)' }}>1h ago</td>
                        <td style={{ padding: '12px' }}>{inputVal}</td>
                        <td style={{ padding: '12px', color: 'var(--text-subtle)' }}>{cachedVal}</td>
                        <td style={{ padding: '12px' }}>{outputVal}</td>
                        <td style={{ padding: '12px', fontWeight: 700, color: '#ea580c' }}>{totalVal}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          detailedLogs.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '13px' }}>
              No request transactions logged.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-subtle)' }}>
                    <th style={{ padding: '12px' }}>DATE</th>
                    <th style={{ padding: '12px' }}>MODEL</th>
                    <th style={{ padding: '12px' }}>STATUS</th>
                    <th style={{ padding: '12px' }}>API KEY / CLIENT</th>
                    <th style={{ padding: '12px' }}>INPUT</th>
                    <th style={{ padding: '12px' }}>CACHED TOKEN</th>
                    <th style={{ padding: '12px' }}>OUTPUT</th>
                    <th style={{ padding: '12px' }}>COST</th>
                    <th style={{ padding: '12px' }}>SPEED</th>
                  </tr>
                </thead>
                <tbody>
                  {detailedLogs.map((row, index) => {
                    let speedText = '—';
                    try {
                      const meta = JSON.parse(row.meta || '{}');
                      if (meta.duration_ms && meta.duration_ms > 0) {
                        const totalTokens = row.promptTokens + row.completionTokens;
                        const speed = totalTokens / (meta.duration_ms / 1000.0);
                        speedText = `${speed.toFixed(1)} t/s`;
                      }
                    } catch (e) {}

                    return (
                      <tr key={index} style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                        <td style={{ padding: '12px', color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>
                          {formatLogDate(row.timestamp)}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '4px',
                              background: getProviderColor(row.provider),
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '11px',
                              fontWeight: 700,
                              textTransform: 'uppercase'
                            }}>
                              {row.provider ? row.provider.charAt(0) : 'M'}
                            </div>
                            <span style={{ fontWeight: 600 }}>{row.model}</span>
                          </div>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            color: row.status === 'ok' ? 'var(--color-success)' : 'var(--color-danger)',
                            fontWeight: 600
                          }}>
                            {row.status === 'ok' ? 'Success' : 'Error'}
                          </span>
                        </td>
                        <td style={{ padding: '12px', color: 'var(--text-subtle)' }}>
                          {row.apiKeyName || '—'}
                        </td>
                        <td style={{ padding: '12px' }}>{row.promptTokens.toLocaleString()}</td>
                        <td style={{ padding: '12px', color: 'var(--text-subtle)' }}>
                          {row.cachedTokens > 0 ? row.cachedTokens.toLocaleString() : '—'}
                        </td>
                        <td style={{ padding: '12px' }}>{row.completionTokens.toLocaleString()}</td>
                        <td style={{ padding: '12px' }}>
                          <div>
                            <div style={{ fontWeight: 600 }}>${row.cost.toFixed(6)}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-subtle)', marginTop: '2px', whiteSpace: 'nowrap' }}>
                              ≈ Rp {(row.cost * 17300).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '12px', fontWeight: 600, color: 'var(--text-subtle)' }}>
                          {speedText}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* 4. Bottom Node graph tree visual map */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px' }}>
        
        {/* Connection tree panel */}
        <div
          ref={treeRef}
          className="card"
          style={{ margin: 0, position: 'relative', height: '440px', background: 'var(--bg-card)', overflow: 'hidden', userSelect: 'none' }}
          onWheel={handleTreeWheel}
        >
          {nodes.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', padding: '40px', textAlign: 'center', color: 'var(--text-subtle)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--color-primary)' }}>hub</span>
              <p style={{ fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>No Active Gateways Connected</p>
              <p style={{ fontSize: '12px', maxWidth: '320px', margin: 0 }}>Active connections configured in the Providers panel will show up dynamically in this routing tree graph map.</p>
            </div>
          ) : (
            <div style={{ transform: `scale(${treeScale})`, transformOrigin: `${treeCenterX}px ${treeCenterY}px`, position: 'absolute', top: 0, left: 0, right: 0, height: '100%' }}>
              {/* SVG Connection Lines — only for nodes with traffic */}
              <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                {nodes.filter(n => hasTraffic(n.id)).map((node) => (
                  <path
                    key={node.id}
                    d={`M ${treeCenterX} ${treeCenterY} Q ${(treeCenterX + node.x) / 2} ${(treeCenterY + node.y) / 2} ${node.x} ${node.y}`}
                    fill="none"
                    stroke="var(--color-success)"
                    strokeWidth="2"
                    style={{ filter: 'drop-shadow(0px 0px 4px rgba(16, 185, 129, 0.4))' }}
                  />
                ))}
              </svg>

              {/* Center gateway node */}
              <div style={{ position: 'absolute', top: `${treeCenterY}px`, left: `${treeCenterX}px`, transform: 'translate(-50%, -50%)', background: 'var(--bg-card)', border: '2px solid var(--color-primary)', borderRadius: '8px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: 'var(--glow-primary)', zIndex: 10 }}>
                <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 'bold' }}>m</div>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>myAiRouter</span>
              </div>

              {/* Connected outer nodes */}
              {nodes.map((node) => (
                <div key={node.id} style={{ position: 'absolute', top: `${node.y}px`, left: `${node.x}px`, transform: 'translate(-50%, -50%)', background: 'var(--bg-card)', border: '1.5px solid var(--color-success)', borderRadius: '6px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 0 10px rgba(16, 185, 129, 0.15)', zIndex: 5, opacity: hasTraffic(node.id) ? 1 : 0.5 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-success)' }}>{node.icon}</span>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-main)' }}>{node.name}</span>
                </div>
              ))}
            </div>
          )}

          {/* Zoom controls bottom-left */}
          <div style={{ position: 'absolute', bottom: '16px', left: '16px', display: 'flex', flexDirection: 'column', gap: '4px', background: 'var(--bg-sidebar)', padding: '4px', borderRadius: '6px', border: '1px solid var(--border-color)', zIndex: 20 }}>
            <button onClick={zoomIn} className="btn btn-secondary" style={{ padding: '4px', border: 'none', background: 'transparent' }}><span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span></button>
            <button onClick={zoomOut} className="btn btn-secondary" style={{ padding: '4px', border: 'none', background: 'transparent' }}><span className="material-symbols-outlined" style={{ fontSize: '16px' }}>remove</span></button>
            <button onClick={centerTree} className="btn btn-secondary" style={{ padding: '4px', border: 'none', background: 'transparent' }}><span className="material-symbols-outlined" style={{ fontSize: '16px' }}>center_focus_strong</span></button>
          </div>
        </div>

        {/* Recent logs */}
        <div className="card" style={{ margin: 0, padding: '20px', background: 'var(--bg-card)' }}>
          <h3 className="card-title" style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-subtle)', marginBottom: '16px' }}>Recent Requests</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {logs.length === 0 ? (
              <div style={{ padding: '24px 0', color: 'var(--text-subtle)', fontSize: '13px', textAlign: 'center' }}>
                No recent request transactions logged.
              </div>
            ) : (
              logs.map((l, index) => {
                const color = l.status === 'ok' ? '#10b981' : '#ef4444';
                return (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color, fontSize: '10px' }}>●</span>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>{l.model}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color, fontFamily: 'var(--font-mono)' }}>
                        {l.promptTokens.toLocaleString()}↑ {l.completionTokens.toLocaleString()}↓
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-subtle)', marginTop: '2px' }}>just now</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const formatLogDate = (ts) => {
  try {
    const date = new Date(ts);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    return ts;
  }
};

const getProviderColor = (prov) => {
  const colors = {
    'openai': '#10b981',
    'anthropic': '#ea580c',
    'gemini': '#2563eb',
    'deepseek': '#8b5cf6',
    'kilocode': '#eab308'
  };
  return colors[prov] || '#6b7280';
};
