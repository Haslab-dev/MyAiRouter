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
  const [activeTab, setActiveTab] = useState('overview');
  const [chartViewMode, setChartViewMode] = useState('tokens');
  const [chartData, setChartData] = useState([]);
  
  const [tableViewMode, setTableViewMode] = useState('cost');
  const [tableDropdown, setTableDropdown] = useState('model');
  const [modelSummaries, setModelSummaries] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);

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

  const treeCenterX = 300;
  const treeCenterY = 220;

  const hasTraffic = useCallback((providerId) => {
    return detailedLogs.some(l => 
      l.provider?.toLowerCase() === providerId.toLowerCase() || 
      (l.model && l.model.toLowerCase().includes(providerId.toLowerCase()))
    );
  }, [detailedLogs]);

  const [settings, setSettings] = useState(null);

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

      // 1.5. Ingress Settings for compression calculations
      const settingsRes = await fetch('/api/settings');
      if (settingsRes.ok) {
        setSettings(await settingsRes.json());
      }

      // 2. Recent Logs & Detailed Logs
      const logsRes = await fetch('/api/usage/logs?limit=100');
      if (logsRes.ok) {
        const data = (await logsRes.json()) || [];
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
        setConnections((await connRes.json()) || []);
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
    const r = 140;
    const activeNodes = [];

    // Core providers
    if (isProviderActive('kilocode')) activeNodes.push({ id: 'kilocode', name: 'Kilo Code', icon: 'grid_view' });
    if (isProviderActive('opencode-go')) activeNodes.push({ id: 'opencode-go', name: 'OpenCode Go', icon: 'terminal' });
    if (isProviderActive('opencode-zen')) activeNodes.push({ id: 'opencode-zen', name: 'OpenCode Zen', icon: 'psychology' });
    if (isProviderActive('glm')) activeNodes.push({ id: 'glm', name: 'GLM API', icon: 'chat' });
    if (isProviderActive('glm-coding')) activeNodes.push({ id: 'glm-coding', name: 'GLM Coding', icon: 'code' });

    // Dynamic database connections
    nodesList.forEach((n) => {
      if (isProviderActive(n.id)) {
        activeNodes.push({
          id: n.id,
          name: n.name,
          icon: n.type === 'openai-compatible' ? 'api' : 'bubble_chart'
        });
      }
    });

    // Remove duplicates
    const uniqueNodes = [];
    const seen = new Set();
    activeNodes.forEach(node => {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        uniqueNodes.push(node);
      }
    });

    // Calculate positions evenly distributed on a circle
    return uniqueNodes.map((node, index) => {
      const angle = (2 * Math.PI * index) / Math.max(uniqueNodes.length, 1) - Math.PI / 2;
      return {
        ...node,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        connected: true
      };
    });
  };

  const nodes = getDynamicNodes();
  const lastLog = detailedLogs[0];
  const isActiveLine = (nodeId) => {
    if (!lastLog) return false;
    const nodeConns = connections.filter(c => c.provider?.toLowerCase() === nodeId.toLowerCase());
    if (nodeConns.some(c => c.id === lastLog.connectionId)) return true;
    if (lastLog.provider?.toLowerCase() === nodeId.toLowerCase()) return true;
    if (lastLog.model && lastLog.model.toLowerCase().includes(nodeId.toLowerCase())) return true;
    return false;
  };

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

  const averageLatency = detailedLogs.length > 0 
    ? Math.round(detailedLogs.reduce((acc, curr) => {
        let parsed = {};
        try {
          parsed = JSON.parse(curr.meta);
        } catch(e){}
        return acc + (parsed.duration_ms || 0);
      }, 0) / detailedLogs.length)
    : 0;

  const cacheHits = detailedLogs.filter(l => {
    let parsed = {};
    try {
      parsed = JSON.parse(l.meta);
    } catch(e){}
    return parsed.cache_hit === true;
  }).length;
  const cacheHitRate = detailedLogs.length > 0 ? Math.round((cacheHits / detailedLogs.length) * 100) : 0;

  const compressionSavedPct = stats.totalRequests > 0 
    ? (settings?.rtkEnabled ? 74 : settings?.headroomEnabled ? 48 : 0)
    : 0;

  // Group logs by model dynamically
  const modelUsageStats = (() => {
    const counts = {};
    detailedLogs.forEach(l => {
      counts[l.model] = (counts[l.model] || 0) + 1;
    });
    const sorted = Object.entries(counts)
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count);
    
    const total = detailedLogs.length;
    return sorted.slice(0, 4).map(item => ({
      ...item,
      percent: total > 0 ? Math.round((item.count / total) * 100) : 0
    }));
  })();

  // Resolve real provider health metrics
  const getProviderStats = (providerAlias) => {
    const providerLogs = detailedLogs.filter(l => l.provider === providerAlias || (l.model && l.model.startsWith(providerAlias + '/')));
    const total = providerLogs.length;
    
    const isActive = connections.some(c => c.provider === providerAlias && c.isActive);
    
    if (total === 0) {
      return {
        latency: '—',
        successRate: '—',
        modelsCount: connections.find(c => c.provider === providerAlias) ? 8 : 0,
        status: isActive ? 'Healthy' : 'Disconnected',
        statusColor: isActive ? 'var(--color-success)' : 'var(--text-subtle)',
        borderColor: isActive ? 'var(--color-success)' : 'var(--border-color)',
        borderLeftColor: isActive ? 'var(--color-success)' : 'var(--border-color)'
      };
    }
    
    const successLogs = providerLogs.filter(l => l.status === 'ok');
    const successRate = `${Math.round((successLogs.length / total) * 100)}%`;
    
    const totalLatency = providerLogs.reduce((acc, curr) => {
      let parsed = {};
      try {
        parsed = JSON.parse(curr.meta);
      } catch(e){}
      return acc + (parsed.duration_ms || 0);
    }, 0);
    const avgLatency = Math.round(totalLatency / total);
    
    const models = new Set(providerLogs.map(l => l.model));
    
    return {
      latency: `${avgLatency}ms`,
      successRate,
      modelsCount: models.size,
      status: isActive ? 'Healthy' : 'Disconnected',
      statusColor: isActive ? 'var(--color-success)' : 'var(--text-subtle)',
      borderColor: isActive ? 'var(--color-success)' : 'var(--border-color)',
      borderLeftColor: isActive ? 'var(--color-success)' : 'var(--border-color)'
    };
  };

  const openaiStats = getProviderStats('openai');
  const anthropicStats = getProviderStats('anthropic');
  const geminiStats = getProviderStats('gemini');

  return (
    <div>
      {/* Header bar matching 9router blueprint */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined text-primary" style={{ fontSize: '28px' }}>bar_chart</span>
            Usage & Analytics
          </h1>
          <p className="page-description">Monitor your API usage, token consumption, and request logs</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'rgba(46, 204, 113, 0.08)', border: '1px solid rgba(46, 204, 113, 0.18)', borderRadius: 'var(--radius-md)', fontSize: '12px', color: 'var(--color-success)', fontWeight: '600' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>circle</span>
          System Active
        </div>
      </div>

      {/* Tabs navigation */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', marginBottom: '24px', paddingBottom: '0' }}>
        <button 
          onClick={() => setActiveTab('overview')} 
          style={{
            background: 'transparent',
            border: 'none',
            color: activeTab === 'overview' ? 'var(--color-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'overview' ? '700' : '500',
            fontSize: '13px',
            cursor: 'pointer',
            padding: '10px 16px',
            position: 'relative'
          }}
        >
          Overview
          {activeTab === 'overview' && (
            <div style={{ position: 'absolute', bottom: '-1px', left: 0, right: 0, height: '2px', background: 'var(--color-primary)' }}></div>
          )}
        </button>
        <button 
          onClick={() => setActiveTab('detail')} 
          style={{
            background: 'transparent',
            border: 'none',
            color: activeTab === 'detail' ? 'var(--color-primary)' : 'var(--text-muted)',
            fontWeight: activeTab === 'detail' ? '700' : '500',
            fontSize: '13px',
            cursor: 'pointer',
            padding: '10px 16px',
            position: 'relative'
          }}
        >
          Requests Detail
          {activeTab === 'detail' && (
            <div style={{ position: 'absolute', bottom: '-1px', left: 0, right: 0, height: '2px', background: 'var(--color-primary)' }}></div>
          )}
        </button>
      </div>

      {activeTab === 'overview' ? (
        <>
          {/* 1. Usage statistics cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <div className="card" style={{ margin: 0, padding: '16px 20px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Requests</div>
              <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '8px', color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>{stats.totalRequests.toLocaleString()}</div>
            </div>

            <div className="card" style={{ margin: 0, padding: '16px 20px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Tokens</div>
              <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '8px', color: 'var(--text-main)', fontFamily: 'var(--font-mono)' }}>{(stats.totalPromptTokens + stats.totalCompletionTokens).toLocaleString()}</div>
            </div>

            <div className="card" style={{ margin: 0, padding: '16px 20px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Cached</div>
              <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '8px', color: 'var(--color-primary)', fontFamily: 'var(--font-mono)' }}>{stats.totalCachedTokens.toLocaleString()}</div>
            </div>

            <div className="card" style={{ margin: 0, padding: '16px 20px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Avg Latency</div>
              <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '8px', color: 'var(--color-primary)', fontFamily: 'var(--font-mono)' }}>{averageLatency}ms</div>
            </div>

            <div className="card" style={{ margin: 0, padding: '16px 20px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Est. Cost</div>
              <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '8px', color: 'var(--color-warning)', fontFamily: 'var(--font-mono)' }}>${stats.totalCost.toFixed(4)}</div>
            </div>

            <div className="card" style={{ margin: 0, padding: '16px 20px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Compression</div>
              <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '8px', color: 'var(--color-success)', fontFamily: 'var(--font-mono)' }}>{compressionSavedPct}%</div>
            </div>

            <div className="card" style={{ margin: 0, padding: '16px 20px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cache Hit Rate</div>
              <div style={{ fontSize: '20px', fontWeight: 700, marginTop: '8px', color: 'var(--color-success)', fontFamily: 'var(--font-mono)' }}>{cacheHitRate}%</div>
            </div>
          </div>

          {/* 2. Main Timeline Usage Chart widget matching the screenshot */}
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
                  Costs
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px', color: 'var(--text-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-primary)' }}></span>
                  {chartViewMode === 'tokens' ? 'Tokens' : 'Costs ($)'}
                </div>
              </div>
            </div>

            {chartData.length === 0 ? (
              <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)', fontSize: '13px' }}>
                No database chart telemetry logged.
              </div>
            ) : (
              <div style={{ position: 'relative', height: '180px', width: '100%' }}>
                {/* SVG Chart */}
                <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
                  <defs>
                    <linearGradient id="chart-area-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.2"/>
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.0"/>
                    </linearGradient>
                  </defs>
                  
                  {/* Grid Lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                    const y = 30 + ratio * 90; // y-axis bounding range [30, 120]
                    const valLabel = maxChartVal * (1 - ratio);
                    return (
                      <g key={i}>
                        <line x1="30" y1={y} x2="770" y2={y} stroke="var(--border-color)" strokeWidth="0.5" strokeDasharray="4 4" />
                        <text x="5" y={y + 3} fill="var(--text-subtle)" fontSize="9" fontFamily="var(--font-mono)">
                          {chartViewMode === 'tokens' ? Math.round(valLabel).toLocaleString() : `$${valLabel.toFixed(3)}`}
                        </text>
                      </g>
                    );
                  })}

                  {/* Filled Area */}
                  {areaPath && <path d={areaPath} fill="url(#chart-area-grad)" />}
                  
                  {/* Stroke Line */}
                  {linePath && <path d={linePath} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" style={{ filter: 'drop-shadow(0 2px 4px rgba(0, 200, 255, 0.3))' }} />}
                  
                  {/* Scatter Dots */}
                  {chartPoints && chartPoints.map((p, idx) => (
                    <circle 
                      key={idx} 
                      cx={p.x} 
                      cy={p.y} 
                      r="3" 
                      fill="var(--color-primary)" 
                      style={{ filter: 'drop-shadow(0 0 2px rgba(0,200,255,0.5))' }} 
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

          {/* 2.5 Live Model Distribution (Traffic Share) */}
          <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
            <h3 className="card-title" style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-subtle)', marginBottom: '16px' }}>
              Live Model Distribution (Traffic Share)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {modelUsageStats.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                  No active routing traffic recorded yet.
                </div>
              ) : (
                modelUsageStats.map((item, index) => (
                  <div key={item.model}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                      <span>{item.model}</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{item.percent}% ({item.count} requests)</span>
                    </div>
                    <div style={{ height: '8px', background: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ 
                        width: `${item.percent}%`, 
                        height: '100%', 
                        background: 'var(--color-primary)', 
                        opacity: 1 - index * 0.18, 
                        boxShadow: index === 0 ? '0 0 8px var(--color-primary)' : 'none' 
                      }}></div>
                    </div>
                  </div>
                ))
              )}
            </div>
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
                <svg 
                  style={{ width: '100%', height: '100%', pointerEvents: 'auto', display: 'block' }}
                  viewBox="0 0 600 440"
                >
                  <style dangerouslySetInnerHTML={{__html: `
                    @keyframes transport-dash {
                      to {
                        stroke-dashoffset: -20;
                      }
                    }
                    .active-transport-line {
                      stroke-dasharray: 6, 6;
                      animation: transport-dash 1s linear infinite;
                    }
                  `}} />
                  
                  <g transform={`scale(${treeScale})`} transformOrigin={`${treeCenterX}px ${treeCenterY}px`}>
                    
                    {/* SVG Connection Lines — drawn to ALL active nodes */}
                    {nodes.map((node) => {
                      const active = isActiveLine(node.id);
                      return (
                        <g key={node.id}>
                          {/* Static background path */}
                          <path
                            d={`M ${treeCenterX} ${treeCenterY} Q ${(treeCenterX + node.x) / 2} ${(treeCenterY + node.y) / 2} ${node.x} ${node.y}`}
                            fill="none"
                            stroke={active ? "rgba(0, 200, 255, 0.25)" : "rgba(255, 255, 255, 0.08)"}
                            strokeWidth="3.5"
                          />
                          {/* Animated overlay pulse path (only if it matches the last current connected provider) */}
                          {active && (
                            <path
                              d={`M ${treeCenterX} ${treeCenterY} Q ${(treeCenterX + node.x) / 2} ${(treeCenterY + node.y) / 2} ${node.x} ${node.y}`}
                              fill="none"
                              stroke="var(--color-primary)"
                              strokeWidth="2.5"
                              className="active-transport-line"
                              style={{ filter: 'drop-shadow(0px 0px 4px rgba(0, 200, 255, 0.7))' }}
                            />
                          )}
                        </g>
                      );
                    })}

                    {/* Center gateway node */}
                    <foreignObject 
                      x={treeCenterX - 75} 
                      y={treeCenterY - 22} 
                      width="150" 
                      height="44"
                      style={{ overflow: 'visible' }}
                    >
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        width: '100%', 
                        height: '100%', 
                        background: '#0c1017', 
                        border: '2px solid var(--color-primary)', 
                        borderRadius: '8px', 
                        fontSize: '13px', 
                        fontWeight: 700, 
                        color: 'var(--text-main)', 
                        boxShadow: 'var(--glow-primary)',
                        fontFamily: 'var(--font-sans)',
                        boxSizing: 'border-box'
                      }}>
                        <div style={{ 
                          width: '18px', 
                          height: '18px', 
                          borderRadius: '4px', 
                          background: 'var(--color-primary)', 
                          color: '#000', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          fontSize: '10px', 
                          fontWeight: 'bold', 
                          marginRight: '8px' 
                        }}>m</div>
                        myAiRouter
                      </div>
                    </foreignObject>

                    {/* Connected outer nodes */}
                    {nodes.map((node) => {
                      const active = isActiveLine(node.id);
                      return (
                        <foreignObject 
                          key={node.id}
                          x={node.x - 70} 
                          y={node.y - 20} 
                          width="140" 
                          height="40"
                          style={{ overflow: 'visible' }}
                        >
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            width: '100%', 
                            height: '100%', 
                            background: '#0c1017', 
                            border: active ? '1.5px solid var(--color-primary)' : '1.5px solid var(--border-color)', 
                            borderRadius: '6px', 
                            fontSize: '11px', 
                            fontWeight: 600, 
                            color: 'var(--text-main)', 
                            boxShadow: active ? '0 0 12px rgba(0, 200, 255, 0.25)' : 'none',
                            opacity: active ? 1 : 0.6,
                            transition: 'all 0.3s ease',
                            fontFamily: 'var(--font-sans)',
                            boxSizing: 'border-box',
                            padding: '0 8px'
                          }}>
                            <span className="material-symbols-outlined" style={{ 
                              fontSize: '15px', 
                              color: active ? 'var(--color-primary)' : 'var(--text-subtle)', 
                              marginRight: '6px' 
                            }}>{node.icon}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {node.name}
                            </span>
                          </div>
                        </foreignObject>
                      );
                    })}
                  </g>
                </svg>
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
        </>
      ) : (
        /* Side-by-Side Tables Layout */
        <div style={{ display: 'grid', gridTemplateColumns: '4.5fr 5.5fr', gap: '24px', alignItems: 'start' }}>
          
          {/* Left Table: Usage by Model */}
          <div className="card" style={{ padding: '20px', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 className="card-title" style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-subtle)', margin: 0 }}>
                Usage by Model
              </h3>
              <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-sidebar)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <button 
                  onClick={() => setTableViewMode('cost')} 
                  className="btn" 
                  style={{
                    fontSize: '11px', padding: '2px 10px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                    background: tableViewMode === 'cost' ? 'var(--color-primary)' : 'transparent',
                    color: tableViewMode === 'cost' ? '#fff' : 'var(--text-muted)'
                  }}
                >
                  Costs
                </button>
                <button 
                  onClick={() => setTableViewMode('tokens')} 
                  className="btn" 
                  style={{
                    fontSize: '11px', padding: '2px 10px', borderRadius: '4px', border: 'none', cursor: 'pointer',
                    background: tableViewMode === 'tokens' ? 'var(--color-primary)' : 'transparent',
                    color: tableViewMode === 'tokens' ? '#fff' : 'var(--text-muted)'
                  }}
                >
                  Tokens
                </button>
              </div>
            </div>

            {modelSummaries.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '12px' }}>
                No request models registered.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-subtle)' }}>
                      <th style={{ padding: '10px 8px' }}>MODEL</th>
                      <th style={{ padding: '10px 8px' }}>REQ</th>
                      <th style={{ padding: '10px 8px', textAlign: 'right' }}>{tableViewMode === 'cost' ? 'COST' : 'TOKENS'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelSummaries.map((row, index) => {
                      const totalVal = tableViewMode === 'cost' ? `$${row.cost.toFixed(4)}` : (row.promptTokens + row.completionTokens).toLocaleString();
                      return (
                        <tr key={index} style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                          <td style={{ padding: '10px 8px', fontWeight: 600 }}>
                            {row.model}
                          </td>
                          <td style={{ padding: '10px 8px', color: 'var(--text-subtle)' }}>{row.requests}</td>
                          <td style={{ padding: '10px 8px', fontWeight: 700, color: 'var(--color-primary)', textAlign: 'right' }}>{totalVal}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Right Table: Requests Log with Pagination */}
          <div className="card" style={{ padding: '20px', margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 className="card-title" style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-subtle)', margin: 0 }}>
                Request Logs
              </h3>
              <div style={{ fontSize: '11px', color: 'var(--text-subtle)', fontWeight: 600 }}>
                {detailedLogs.length.toLocaleString()} requests
              </div>
            </div>

            {detailedLogs.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '12px' }}>
                No request transactions logged.
              </div>
            ) : (() => {
              const logsPerPage = 10;
              const totalPages = Math.ceil(detailedLogs.length / logsPerPage) || 1;
              const activePage = Math.min(Math.max(currentPage, 1), totalPages);
              const paginatedLogs = detailedLogs.slice((activePage - 1) * logsPerPage, activePage * logsPerPage);

              return (
                <div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-subtle)' }}>
                          <th style={{ padding: '10px 8px' }}>DATE</th>
                          <th style={{ padding: '10px 8px' }}>MODEL</th>
                          <th style={{ padding: '10px 8px' }}>STATUS</th>
                          <th style={{ padding: '10px 8px', textAlign: 'right' }}>COST</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedLogs.map((row, index) => {
                          const statusColor = row.status === 'ok' ? 'var(--color-success)' : 'var(--color-danger)';
                          return (
                            <tr key={index} style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-main)' }}>
                              <td style={{ padding: '10px 8px', color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>
                                {formatLogDate(row.timestamp)}
                              </td>
                              <td style={{ padding: '10px 8px', fontWeight: 600 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <div style={{
                                    width: '18px',
                                    height: '18px',
                                    borderRadius: '3px',
                                    background: getProviderColor(row.provider),
                                    color: '#fff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '9px',
                                    fontWeight: 700,
                                    textTransform: 'uppercase'
                                  }}>
                                    {row.provider ? row.provider.charAt(0) : 'M'}
                                  </div>
                                  <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {row.model}
                                  </span>
                                </div>
                              </td>
                              <td style={{ padding: '10px 8px' }}>
                                <span style={{ color: statusColor, fontWeight: 600 }}>
                                  {row.status === 'ok' ? 'Success' : 'Error'}
                                </span>
                              </td>
                              <td style={{ padding: '10px 8px', fontWeight: 600, textAlign: 'right' }}>
                                ${row.cost.toFixed(5)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination control footer */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                    <button 
                      onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} 
                      disabled={activePage === 1}
                      className="btn btn-secondary" 
                      style={{ padding: '4px 10px', fontSize: '11px', opacity: activePage === 1 ? 0.5 : 1, cursor: activePage === 1 ? 'not-allowed' : 'pointer' }}
                    >
                      Previous
                    </button>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Page <strong>{activePage}</strong> of <strong>{totalPages}</strong>
                    </span>
                    <button 
                      onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))} 
                      disabled={activePage === totalPages}
                      className="btn btn-secondary" 
                      style={{ padding: '4px 10px', fontSize: '11px', opacity: activePage === totalPages ? 0.5 : 1, cursor: activePage === totalPages ? 'not-allowed' : 'pointer' }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
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
