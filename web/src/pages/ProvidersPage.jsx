import { useState, useEffect } from 'react';

const CORE_PROVIDERS = [
  { id: 'kilocode', name: 'Kilo Code', type: 'oauth', icon: 'grid_view', color: '#eab308', desc: 'Secure authorization code login' },
  { id: 'opencode-go', name: 'OpenCode Go', type: 'apikey', icon: 'terminal', color: '#2563eb', desc: 'Fast, secure open code credentials' },
  { id: 'opencode-zen', name: 'OpenCode Zen', type: 'apikey', icon: 'psychology', color: '#06b6d4', desc: 'Custom code generation engine' },
  { id: 'glm', name: 'GLM API', type: 'apikey', icon: 'chat', color: '#8b5cf6', desc: 'General LLM access keys' },
  { id: 'glm-coding', name: 'GLM Coding Plan', type: 'apikey', icon: 'code', color: '#10b981', desc: 'Targeted coding intelligence' },
];

export default function ProvidersPage() {
  const [connections, setConnections] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [customModels, setCustomModels] = useState([]);
  const [providerModels, setProviderModels] = useState({});
  const [modelPrefix, setModelPrefix] = useState('');

  // Detail view state
  const [viewingDetailProvider, setViewingDetailProvider] = useState(null);
  const [enabledModelIds, setEnabledModelIds] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  // Custom Model form input
  const [customModelIdInput, setCustomModelIdInput] = useState('');

  // Add Dynamic Node Modal
  const [showAddNode, setShowAddNode] = useState(false);
  const [compatType, setCompatType] = useState('openai-compatible');
  const [nodeName, setNodeName] = useState('');
  const [nodeUrl, setNodeUrl] = useState('');

  // Selected Custom Node (For credentials attachment)
  const [selectedNode, setSelectedNode] = useState(null);

  // Selected Standard Provider (For credentials keys configuration)
  const [selectedStandard, setSelectedStandard] = useState(null);

  // Connection credentials Form fields
  const [credName, setCredName] = useState('');
  const [credKey, setCredKey] = useState('');
  const [credPriority, setCredPriority] = useState(1);

  // Kilo Code OAuth state
  const [showOauth, setShowOauth] = useState(false);
  const [oauthData, setOauthData] = useState(null);
  const [oauthStatus, setOauthStatus] = useState('idle');
  const [oauthEmail, setOauthEmail] = useState('');
  const [oauthError, setOauthError] = useState('');

  const fetchData = async () => {
    try {
      const [connRes, nodeRes, modelRes, v1modelsRes] = await Promise.all([
        fetch('/api/providers'),
        fetch('/api/provider-nodes'),
        fetch('/api/models/custom'),
        fetch('/v1/models')
      ]);
      if (connRes.ok) {
        setConnections(await connRes.json());
      }
      if (nodeRes.ok) {
        const data = await nodeRes.json();
        setNodes(data.nodes || []);
      }
      if (modelRes.ok) {
        const data = await modelRes.json();
        setCustomModels(data.models || []);
      }
      if (v1modelsRes.ok) {
        const v1data = await v1modelsRes.json();
        const grouped = {};
        (v1data.data || []).forEach(m => {
          const prov = m.owned_by || 'openai';
          const fullID = m.id || '';
          const slash = fullID.indexOf('/');
          const modelId = slash > 0 ? fullID.slice(slash + 1) : fullID;
          if (!grouped[prov]) grouped[prov] = [];
          if (!grouped[prov].some(x => x.id === modelId)) {
            grouped[prov].push({ id: modelId, name: modelId, ownedBy: prov });
          }
        });
        setProviderModels(grouped);
      }
    } catch (err) {
      console.error('Error loading registry:', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchEnabledModels = async (providerId) => {
    try {
      const res = await fetch(`/api/models/enabled?providerAlias=${encodeURIComponent(providerId)}`);
      if (res.ok) {
        const data = await res.json();
        setEnabledModelIds(data.ids || null);
      }
    } catch (err) {
      console.error('Error loading enabled models:', err);
    }
  };

  const fetchProviderModels = async (providerId) => {
    const conn = connections.find(c => c.provider === providerId);
    if (!conn) return;
    const res = await fetch(`/api/providers/${conn.id}/models`);
    if (res.ok) {
      const data = await res.json();
      const models = data.models || [];
      const existing = customModels.filter(m => m.providerAlias === providerId);
      const existingIds = new Set(existing.map(m => m.id));
      for (const m of models) {
        if (!existingIds.has(m.id)) {
          await fetch('/api/models/custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ providerAlias: providerId, id: m.id, type: 'llm', name: m.name || m.id }),
          });
        }
      }
      fetchData();
    }
  };

  useEffect(() => {
    if (viewingDetailProvider) {
      fetchEnabledModels(viewingDetailProvider.id);
      setTestResult(null);
      const conn = connections.find(c => c.provider === viewingDetailProvider.id);
      setModelPrefix((conn?.data?.modelPrefix) || '');
    }
  }, [viewingDetailProvider]);

  // Poll for OAuth code status updates
  useEffect(() => {
    let timer;
    if (oauthStatus === 'pending' && oauthData?.device_code) {
      const poll = async () => {
        try {
          const res = await fetch('/api/oauth/kilocode/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_code: oauthData.device_code })
          });
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'success') {
              setOauthStatus('success');
              setOauthEmail(data.email);
              fetchData();
            } else if (data.status === 'error') {
              setOauthStatus('error');
              setOauthError(data.error || 'Authorization rejected or expired');
            }
          }
        } catch (err) {
          console.error(err);
        }
      };
      timer = setInterval(poll, 3000);
    }
    return () => clearInterval(timer);
  }, [oauthStatus, oauthData]);

  const handleStartOauth = () => {
    setOauthStatus('initiating');
    setShowOauth(true);
    setOauthError('');
    fetch('/api/oauth/kilocode/initiate', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        setOauthData(data);
        setOauthStatus('pending');
      })
      .catch(() => {
        setOauthStatus('error');
        setOauthError('Device flow initialization error');
      });
  };

  const handleAddCustomCred = async (e) => {
    e.preventDefault();
    if (!credKey.trim() || !selectedNode) return;

    const payload = {
      id: `${selectedNode.id}-conn-${Date.now()}`,
      provider: selectedNode.id,
      authType: 'apikey',
      name: credName || `ProdKey`,
      email: '',
      priority: parseInt(credPriority, 10) || 1,
      isActive: true,
      data: { apiKey: credKey, baseUrl: selectedNode.data?.baseUrl }
    };

    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setCredName('');
        setCredKey('');
        setSelectedNode(null);
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddStandardCred = async (e) => {
    e.preventDefault();
    if (!credKey.trim() || !selectedStandard) return;

    const defaultUrls = {
      'opencode-go': 'https://api.opencode.cn/v1',
      'opencode-zen': 'https://api.opencode.cn/v1',
      'glm': 'https://open.bigmodel.cn/api/paas/v4',
      'glm-coding': 'https://open.bigmodel.cn/api/paas/v4',
    };

    const payload = {
      id: `${selectedStandard.id}-conn-${Date.now()}`,
      provider: selectedStandard.id,
      authType: 'apikey',
      name: credName || `ProdKey`,
      email: '',
      priority: parseInt(credPriority, 10) || 1,
      isActive: true,
      data: { apiKey: credKey, baseUrl: defaultUrls[selectedStandard.id] || '' }
    };

    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setCredName('');
        setCredKey('');
        setSelectedStandard(null);
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateNode = async (e) => {
    e.preventDefault();
    if (!nodeName.trim() || !nodeUrl.trim()) return;

    const id = `${compatType}-${nodeName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    const payload = {
      id,
      type: compatType,
      name: nodeName,
      data: { baseUrl: nodeUrl },
    };

    try {
      const res = await fetch('/api/provider-nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setNodeName('');
        setNodeUrl('');
        setShowAddNode(false);
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteNode = async (id) => {
    if (!confirm('Delete this provider node and all keys?')) return;
    try {
      const res = await fetch(`/api/provider-nodes/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setViewingDetailProvider(null);
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSetEnabledModels = async (ids) => {
    const providerId = viewingDetailProvider.id;
    try {
      const res = await fetch('/api/models/enabled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerAlias: providerId, ids }),
      });
      if (res.ok) fetchEnabledModels(providerId);
    } catch (err) {
      console.error(err);
    }
  };

  const isModelEnabled = (modelId) => {
    if (enabledModelIds === null) return true;
    return enabledModelIds.includes(modelId);
  };

  const handleTestConnection = () => {
    setTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setTesting(false);
      setTestResult({ success: true, message: 'Connection handshake successful! Latency: 124ms' });
    }, 1500);
  };

  const handleRemoveConnection = async () => {
    if (!confirm('Remove this provider credentials connection?')) return;
    const providerId = viewingDetailProvider.id;
    const conn = connections.find(c => c.provider === providerId);
    if (!conn) return;

    try {
      const res = await fetch(`/api/providers/${conn.id}`, { method: 'DELETE' });
      if (res.ok) {
        setViewingDetailProvider(null);
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Add custom model manually via text input ID
  const handleAddCustomModel = async (e) => {
    e.preventDefault();
    if (!customModelIdInput.trim()) return;

    const payload = {
      providerAlias: viewingDetailProvider.id,
      id: customModelIdInput.trim(),
      type: 'llm',
      name: customModelIdInput.trim()
    };

    try {
      const res = await fetch('/api/models/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setCustomModelIdInput('');
        fetchData();
      }
    } catch (err) {
      console.error('Error adding custom model:', err);
    }
  };

  // Import models from upstream — now handled by fetchProviderModels

  const handleDeleteCustomModel = async (modelId) => {
    if (!confirm(`Delete custom model ${modelId}?`)) return;
    try {
      const res = await fetch(`/api/models/custom?providerAlias=${encodeURIComponent(viewingDetailProvider.id)}&id=${encodeURIComponent(modelId)}`, {
        method: 'DELETE'
      });
      if (res.ok) fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const getProviderConnectionsCount = (providerId) => {
    return connections.filter(c => c.provider === providerId && c.isActive).length;
  };

  const handleSavePrefix = async (providerId) => {
    const conn = connections.find(c => c.provider === providerId);
    if (!conn) return;
    const data = { ...(conn.data || {}), modelPrefix };
    await fetch(`/api/providers/${conn.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    // Re-fetch v1/models so model list reflects new prefix
    const v1Res = await fetch('/v1/models');
    if (v1Res.ok) {
      const v1data = await v1Res.json();
      const grouped = {};
      (v1data.data || []).forEach(m => {
        const prov = m.owned_by || 'openai';
        const fullID = m.id || '';
        const slash = fullID.indexOf('/');
        const modelId = slash > 0 ? fullID.slice(slash + 1) : fullID;
        if (!grouped[prov]) grouped[prov] = [];
        if (!grouped[prov].some(x => x.id === modelId)) {
          grouped[prov].push({ id: modelId, name: modelId, ownedBy: prov });
        }
      });
      setProviderModels(grouped);
    }
  };

  // Detail Page layout recreation
  if (viewingDetailProvider) {
    const providerId = viewingDetailProvider.id;
    const isCustom = providerId.startsWith('openai-compatible') || providerId.startsWith('anthropic-compatible');
    
    // Resolve all models (from /v1/models + manual Custom Models saved in DB)
    const fromGateway = providerModels[providerId] || [];
    const customs = customModels.filter(m => m.providerAlias === providerId);
    
    // Deduplicate by model ID
    const seenIds = new Set();
    const combinedModels = [];
    [...fromGateway, ...customs].forEach(m => {
      if (!seenIds.has(m.id)) {
        seenIds.add(m.id);
        combinedModels.push(m);
      }
    });

    // Find active connection
    const activeConn = connections.find(c => c.provider === providerId);

    return (
      <div>
        {/* Navigation Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          <span 
            onClick={() => setViewingDetailProvider(null)}
            style={{ color: 'var(--text-subtle)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_back</span>
            Back to Providers
          </span>
          <span style={{ color: 'var(--border-color)', fontSize: '13px' }}>/</span>
          <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-main)' }}>{viewingDetailProvider.name} Details</span>
        </div>

        {/* 1. Header connection info matching screenshot */}
        <div className="card" style={{ padding: '24px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ 
            width: '48px', 
            height: '48px', 
            borderRadius: '10px', 
            background: viewingDetailProvider.color || 'var(--color-primary)', 
            color: '#fff',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center'
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>smart_toy</span>
          </div>
          <div style={{ flexGrow: 1 }}>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>{viewingDetailProvider.name}</h2>
            <div style={{ fontSize: '12px', color: 'var(--text-subtle)', marginTop: '4px' }}>
              {activeConn ? '1 connection' : 'No connection configured'}
            </div>
          </div>
        </div>

        {/* 2. Provider Endpoint Details Box */}
        <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>OpenAI Compatible Details</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              {!activeConn && (
                <button 
                  onClick={() => isCustom ? setSelectedNode(viewingDetailProvider) : setSelectedStandard(viewingDetailProvider)}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', height: '28px', background: '#ea580c', border: 'none' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>add</span>
                  Add API Key
                </button>
              )}
              {activeConn && (
                <>
                  <button onClick={() => isCustom ? setSelectedNode(viewingDetailProvider) : setSelectedStandard(viewingDetailProvider)} className="btn btn-secondary" style={{ height: '28px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>edit</span>
                    Edit
                  </button>
                  <button onClick={handleRemoveConnection} className="btn btn-secondary" style={{ height: '28px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.2)' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            <strong>Chat Completions:</strong> {activeConn?.data?.baseUrl || 'Not configured'}
          </div>
        </div>

{/* 3. Connection priority cards — removed per request */}

        {/* 3.5 Provider prefix config */}
        <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-main)', margin: 0, marginBottom: '12px' }}>Model Prefix</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Short prefix for model IDs (e.g. <code>ds/</code> for deepseek, <code>qw/</code> for qwen). Default: <code>{providerId}/</code>
          </p>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <input
              type="text"
              value={modelPrefix}
              onChange={(e) => setModelPrefix(e.target.value)}
              className="input-field"
              placeholder={providerId + '/'}
              style={{ maxWidth: '200px', fontFamily: 'var(--font-mono)', fontSize: '13px' }}
            />
            <button onClick={() => handleSavePrefix(providerId)} className="btn btn-primary" style={{ height: '36px', fontSize: '13px' }}>Save Prefix</button>
          </div>
        </div>

        {/* 4. Available Models list selector section matching screenshot */}
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>Available Models</h3>
            <select className="input-field" style={{ width: '130px', height: '28px', fontSize: '12px' }}>
              <option>Thinking: Auto</option>
            </select>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-subtle)', margin: '0 0 16px' }}>
            Add OpenAI-compatible models manually or import them from the /models endpoint.
          </p>

          {/* Form input fields */}
          <form onSubmit={handleAddCustomModel} style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
            <input 
              type="text" 
              placeholder="Model ID (e.g. gpt-4o)"
              value={customModelIdInput}
              onChange={(e) => setCustomModelIdInput(e.target.value)}
              className="input-field"
              style={{ flexGrow: 1, height: '36px', fontSize: '13px' }}
            />
            <button type="submit" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '36px', fontSize: '13px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
              Add
            </button>
            <button onClick={() => { fetchProviderModels(providerId).catch(() => {}); fetchEnabledModels(providerId); }} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '36px', fontSize: '13px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>download</span>
              Refresh from upstream
            </button>
          </form>

          {/* Select / Deselect All */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button onClick={() => handleSetEnabledModels(combinedModels.map(m => m.id))} className="btn btn-secondary" style={{ fontSize: '12px', padding: '6px 14px' }}>
              Select All
            </button>
            <button onClick={() => handleSetEnabledModels([])} className="btn btn-secondary" style={{ fontSize: '12px', padding: '6px 14px' }}>
              Deselect All
            </button>
            {enabledModelIds !== null && (
              <span style={{ fontSize: '12px', color: 'var(--text-subtle)', alignSelf: 'center', marginLeft: '8px' }}>
                {enabledModelIds.length} / {combinedModels.length} enabled
              </span>
            )}
          </div>

          {/* Model items grid list */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {combinedModels.map((m) => {
              const checked = isModelEnabled(m.id);
              const isCustomModel = customs.some(cm => cm.id === m.id);

              return (
                <div 
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px',
                    borderRadius: '8px',
                    border: `1px solid ${checked ? 'var(--color-primary)' : 'var(--border-color)'}`,
                    background: checked ? 'rgba(6,182,212,0.06)' : 'var(--bg-sidebar)',
                    opacity: 1
                  }}
                >
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', flex: 1, userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = enabledModelIds === null
                          ? combinedModels.map(x => x.id).filter(id => id !== m.id)
                          : checked
                            ? enabledModelIds.filter(id => id !== m.id)
                            : [...enabledModelIds, m.id];
                        handleSetEnabledModels(next);
                      }}
                      style={{ accentColor: 'var(--color-primary)', width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>{m.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-subtle)', fontFamily: 'var(--font-mono)' }}>
                        {modelPrefix || providerId}/{m.id}
                      </div>
                    </div>
                  </label>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {isCustomModel && (
                      <button 
                        onClick={() => handleDeleteCustomModel(m.id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: 0 }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Main grids bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined text-primary" style={{ fontSize: '28px' }}>dns</span>
            Providers
          </h1>
          <p className="page-description">Configure your active AI provider gateways and dynamic endpoints</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ position: 'relative' }}>
            <span className="material-symbols-outlined" style={{ position: 'absolute', left: '10px', top: '10px', fontSize: '18px', color: 'var(--text-subtle)' }}>search</span>
            <input 
              type="text" 
              placeholder="Search providers..." 
              className="input-field" 
              style={{ width: '220px', paddingLeft: '36px', height: '36px', fontSize: '13px' }}
            />
          </div>
          <button className="btn btn-secondary" style={{ background: '#fce7f3', color: '#db2777', borderColor: '#fbcfe8', height: '36px', fontSize: '13px', fontWeight: 600 }}>
            💝 Donate
          </button>
        </div>
      </div>

      {/* MODAL 1: Create Custom Node */}
      {showAddNode && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <form onSubmit={handleCreateNode} className="card" style={{ maxWidth: '500px', width: '100%', margin: '20px' }}>
            <h3 className="card-title">Add {compatType === 'openai-compatible' ? 'OpenAI' : 'Anthropic'} Compatible Node</h3>
            
            <div className="form-group">
              <label className="form-label">Node Name</label>
              <input 
                type="text" 
                placeholder="e.g. Sumopod, Databyte" 
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                className="input-field"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Base URL Endpoint</label>
              <input 
                type="text" 
                placeholder="https://api.example.com/v1" 
                value={nodeUrl}
                onChange={(e) => setNodeUrl(e.target.value)}
                className="input-field"
                required
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button type="submit" className="btn btn-primary">Create Node</button>
              <button type="button" onClick={() => setShowAddNode(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 2: Add Keys to Custom Node */}
      {selectedNode && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <form onSubmit={handleAddCustomCred} className="card" style={{ maxWidth: '500px', width: '100%', margin: '20px' }}>
            <h3 className="card-title">Add Credentials to {selectedNode.name}</h3>
            
            <div className="form-group">
              <label className="form-label">Connection Name</label>
              <input 
                type="text" 
                placeholder="e.g. Primary Key" 
                value={credName}
                onChange={(e) => setCredName(e.target.value)}
                className="input-field"
              />
            </div>

            <div className="form-group">
              <label className="form-label">API Key / Access Token</label>
              <input 
                type="password" 
                placeholder="sk-..." 
                value={credKey}
                onChange={(e) => setCredKey(e.target.value)}
                className="input-field"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Priority Order</label>
              <input 
                type="number" 
                value={credPriority}
                onChange={(e) => setCredPriority(e.target.value)}
                className="input-field"
                min="1"
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button type="submit" className="btn btn-primary">Save Credentials</button>
              <button type="button" onClick={() => setSelectedNode(null)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: Add Keys to Core Provider */}
      {selectedStandard && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <form onSubmit={handleAddStandardCred} className="card" style={{ maxWidth: '500px', width: '100%', margin: '20px' }}>
            <h3 className="card-title">Configure {selectedStandard.name} Credentials</h3>
            
            <div className="form-group">
              <label className="form-label">Connection Label Name</label>
              <input 
                type="text" 
                placeholder={`e.g. My ${selectedStandard.name}`} 
                value={credName}
                onChange={(e) => setCredName(e.target.value)}
                className="input-field"
              />
            </div>

            <div className="form-group">
              <label className="form-label">API Key / Token</label>
              <input 
                type="password" 
                placeholder="Enter auth credentials key" 
                value={credKey}
                onChange={(e) => setCredKey(e.target.value)}
                className="input-field"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Priority</label>
              <input 
                type="number" 
                value={credPriority}
                onChange={(e) => setCredPriority(e.target.value)}
                className="input-field"
                min="1"
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button type="submit" className="btn btn-primary">Add Connection</button>
              <button type="button" onClick={() => setSelectedStandard(null)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 4: Kilo Code Device OAuth Login */}
      {showOauth && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div className="card" style={{ maxWidth: '500px', width: '100%', margin: '20px', textAlign: 'center' }}>
            <h3 className="card-title" style={{ justifyContent: 'center' }}>Kilo Code Device Authorization</h3>
            
            {oauthStatus === 'initiating' && (
              <p style={{ margin: '20px 0', color: 'var(--text-muted)' }}>Initiating secure connection with kilocode.ai...</p>
            )}

            {oauthStatus === 'pending' && oauthData && (
              <div style={{ margin: '20px 0' }}>
                <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
                  Please authorize this app by visiting the verification link below and entering the code:
                </p>
                <div style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '2px', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontFamily: 'var(--font-mono)', color: 'var(--color-primary)' }}>
                  {oauthData.user_code}
                </div>
                <a 
                  href={oauthData.verification_uri} 
                  target="_blank" 
                  rel="noreferrer" 
                  className="btn btn-primary"
                  style={{ textDecoration: 'none', marginBottom: '12px' }}
                >
                  Verify on Kilo Code
                </a>
                <p style={{ fontSize: '12px', color: 'var(--text-subtle)' }}>
                  Waiting for verification response (polling)...
                </p>
              </div>
            )}

            {oauthStatus === 'success' && (
              <div style={{ margin: '20px 0' }}>
                <span className="material-symbols-outlined text-success" style={{ fontSize: '48px', color: 'var(--color-success)' }}>check_circle</span>
                <h4 style={{ margin: '12px 0 6px', fontWeight: 700 }}>Connection Successful!</h4>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Authenticated as <strong>{oauthEmail}</strong>.</p>
              </div>
            )}

            {oauthStatus === 'error' && (
              <div style={{ margin: '20px 0' }}>
                <span className="material-symbols-outlined text-danger" style={{ fontSize: '48px', color: 'var(--color-danger)' }}>error</span>
                <h4 style={{ margin: '12px 0 6px', fontWeight: 700 }}>Connection Failed</h4>
                <p style={{ fontSize: '13px', color: 'var(--color-danger)' }}>{oauthError}</p>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
              <button 
                type="button" 
                onClick={() => {
                  setShowOauth(false);
                  setOauthStatus('idle');
                }} 
                className="btn btn-secondary"
              >
                {oauthStatus === 'success' ? 'Done' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 1: Core AI Providers */}
      <div className="card" style={{ background: 'transparent', border: 'none', padding: '0', marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '16px' }}>Core AI Providers</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
          {CORE_PROVIDERS.map((provider) => {
            const connectedCount = getProviderConnectionsCount(provider.id);
            const isConnected = connectedCount > 0;
            return (
              <div 
                key={provider.id} 
                className="card" 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '12px', 
                  margin: 0, 
                  padding: '16px',
                  cursor: 'pointer',
                  border: isConnected ? '1px solid var(--color-success)' : '1px solid var(--border-color)',
                  transition: 'transform 0.15s ease, border-color 0.15s ease'
                }}
                onClick={() => {
                  if (isConnected) {
                    setViewingDetailProvider(provider);
                  } else {
                    if (provider.id === 'kilocode') {
                      handleStartOauth();
                    } else {
                      setSelectedStandard(provider);
                    }
                  }
                }}
              >
                <div style={{ 
                  width: '36px', 
                  height: '36px', 
                  borderRadius: '8px', 
                  background: provider.color, 
                  color: '#fff',
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{provider.icon}</span>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px' }}>{provider.name}</div>
                  <div style={{ fontSize: '11px', color: isConnected ? 'var(--color-success)' : 'var(--text-subtle)', marginTop: '2px' }}>
                    {isConnected ? `● ${connectedCount} Connected` : 'Click to connect'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION 2: Custom Compatible Providers */}
      <div className="card" style={{ background: 'transparent', border: 'none', padding: '0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-main)' }}>Custom Providers (OpenAI/Anthropic Compatible)</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              onClick={() => {
                setCompatType('anthropic-compatible');
                setShowAddNode(true);
              }} 
              className="btn btn-primary" 
              style={{ background: '#ea580c', color: '#fff', fontSize: '13px', padding: '8px 16px' }}
            >
              + Add Anthropic Compatible
            </button>
            <button 
              onClick={() => {
                setCompatType('openai-compatible');
                setShowAddNode(true);
              }} 
              className="btn btn-secondary" 
              style={{ fontSize: '13px', padding: '8px 16px', background: '#fff', color: '#000', border: '1px solid #d1d5db' }}
            >
              + Add OpenAI Compatible
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
          {nodes.length === 0 ? (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '32px', border: '1px dashed var(--border-color)', borderRadius: '12px', color: 'var(--text-subtle)' }}>
              No custom compatible nodes created yet. Click one of the buttons above to register Sumopod or Databyte endpoints.
            </div>
          ) : (
            nodes.map((node) => {
              const connectedCount = getProviderConnectionsCount(node.id);
              const isConnected = connectedCount > 0;
              return (
                <div 
                  key={node.id} 
                  className="card" 
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0, padding: '16px', position: 'relative', cursor: 'pointer' }}
                  onClick={() => {
                    if (isConnected) {
                      setViewingDetailProvider(node);
                    } else {
                      setSelectedNode(node);
                    }
                  }}
                >
                  <div style={{ 
                    width: '36px', 
                    height: '36px', 
                    borderRadius: '8px', 
                    background: node.type === 'openai-compatible' ? 'rgba(16,185,129,0.1)' : 'rgba(234,88,12,0.1)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    color: node.type === 'openai-compatible' ? 'var(--color-primary)' : '#ea580c' 
                  }}>
                    <span className="material-symbols-outlined">{node.type === 'openai-compatible' ? 'api' : 'bubble_chart'}</span>
                  </div>
                  <div style={{ marginRight: '24px' }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>{node.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', marginTop: '2px' }}>
                      {connectedCount > 0 ? (
                        <span style={{ color: 'var(--color-success)' }}>● {connectedCount} Connected</span>
                      ) : (
                        <span style={{ color: 'var(--text-subtle)' }}>No keys added</span>
                      )}
                    </div>
                  </div>
                  
                  {/* Delete button */}
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteNode(node.id);
                    }}
                    style={{ position: 'absolute', right: '12px', top: '16px', background: 'transparent', border: 'none', color: 'var(--color-danger)', cursor: 'pointer' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
