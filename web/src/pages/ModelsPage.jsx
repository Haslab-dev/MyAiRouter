import { useState, useEffect } from 'react';
import { useSnackbar } from '../stores/snackbar';

export default function ModelsPage() {
  const notify = useSnackbar((s) => s.notify);

  const [models, setModels] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [providers, setProviders] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [activeModel, setActiveModel] = useState(null);
  
  // Form states
  const [primaryProvider, setPrimaryProvider] = useState('');
  const [fallbackModel, setFallbackModel] = useState('');
  const [compEnabled, setCompEnabled] = useState(false);
  const [compStrategy, setCompStrategy] = useState('balanced');
  const [compThreshold, setCompThreshold] = useState(64000);
  const [preserveRecent, setPreserveRecent] = useState(20);
  const [compTrigger, setCompTrigger] = useState('threshold');

  useEffect(() => {
    fetchInitData();
  }, []);

  const fetchInitData = async () => {
    try {
      const [modelsRes, policiesRes, providersRes] = await Promise.all([
        fetch('/v1/models'),
        fetch('/api/models/policies'),
        fetch('/api/providers'),
      ]);

      if (modelsRes.ok) {
        const data = await modelsRes.ok && await modelsRes.json();
        setModels(data.data || []);
      }
      if (policiesRes.ok) {
        const data = await policiesRes.json();
        setPolicies(data.policies || []);
      }
      if (providersRes.ok) {
        const data = await providersRes.json();
        setProviders(data || []);
      }
    } catch (err) {
      console.error('Error fetching models setup data:', err);
    }
  };

  const handleConfigure = (model) => {
    setActiveModel(model);
    
    let parsedProvider = 'openai';
    if (model.id.includes('/')) {
      parsedProvider = model.id.split('/')[0];
    }
    setPrimaryProvider(parsedProvider);

    // Find if policy already exists
    const policy = policies.find(p => p.id === model.id);
    
    if (policy) {
      setFallbackModel(policy.routing?.fallback_model || policy.routing?.fallback_provider || '');
      setCompEnabled(policy.compression?.enabled || false);
      setCompStrategy(policy.compression?.strategy || 'balanced');
      setCompThreshold(policy.compression?.threshold_tokens || 64000);
      setCompTrigger(policy.compression?.trigger || 'threshold');
      setPreserveRecent(policy.compression?.preserve_recent_messages || 20);
    } else {
      setFallbackModel('');
      setCompEnabled(false);
      setCompStrategy('balanced');
      setCompThreshold(64000);
      setCompTrigger('threshold');
      setPreserveRecent(20);
    }
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!activeModel) return;

    const payload = {
      id: activeModel.id,
      name: activeModel.id.includes('/') ? activeModel.id.split('/')[1] : activeModel.id,
      routing: {
        primary_provider: primaryProvider,
        fallback_model: fallbackModel || undefined,
      },
      compression: {
        enabled: compEnabled,
        strategy: compStrategy,
        threshold_tokens: parseInt(compThreshold, 10) || 64000,
        trigger: compTrigger,
        preserve_recent_messages: parseInt(preserveRecent, 10) || 20,
      }
    };

    try {
      const res = await fetch('/api/models/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        notify(`Configuration saved for ${activeModel.id}`, 'success');
        setShowModal(false);
        fetchInitData();
      } else {
        const data = await res.json();
        notify(`Error: ${data.error || 'Failed to save configuration'}`, 'error');
      }
    } catch (err) {
      console.error('Error saving model config:', err);
      notify('Network error saving configuration', 'error');
    }
  };

  const handleDeletePolicy = async (id) => {
    if (!confirm(`Reset configuration for ${id} to defaults?`)) return;
    try {
      const res = await fetch(`/api/models/policies?id=${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        notify('Configuration reset to defaults.', 'info');
        fetchInitData();
      } else {
        notify('Failed to reset configuration.', 'error');
      }
    } catch (err) {
      console.error('Error deleting model config:', err);
      notify('Network error resetting configuration', 'error');
    }
  };

  // Filter models based on search query
  const filteredModels = models.filter(m => 
    m.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Helper to determine if provider supports caching
  const isCachingSupported = (provider) => {
    return ['openai', 'deepseek', 'anthropic'].includes(provider?.toLowerCase());
  };

  return (
    <div className="container" style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Models</h1>
          <p style={{ color: 'var(--text-subtle)', fontSize: '13px', marginTop: '4px' }}>
            Configure model-centric routing policies, dynamic compression settings, and provider cache parameters.
          </p>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Search models..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)',
            color: 'var(--text-color)',
            fontSize: '14px',
            outline: 'none',
          }}
        />
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-subtle)', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase' }}>
              <th style={{ padding: '16px 20px' }}>Model ID</th>
              <th style={{ padding: '16px 20px' }}>Primary Provider</th>
              <th style={{ padding: '16px 20px' }}>Fallback Model</th>
              <th style={{ padding: '16px 20px' }}>Compression</th>
              <th style={{ padding: '16px 20px' }}>Cache Preservation</th>
              <th style={{ padding: '16px 20px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredModels.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '14px' }}>
                  No models found matching your search.
                </td>
              </tr>
            ) : (
              filteredModels.map(model => {
                const policy = policies.find(p => p.id === model.id);
                let defaultProvider = 'openai';
                if (model.id.includes('/')) {
                  defaultProvider = model.id.split('/')[0];
                }
                const primary = policy?.routing?.primary_provider || defaultProvider;
                const fallback = policy?.routing?.fallback_model || policy?.routing?.fallback_provider || 'None';
                const comp = policy?.compression?.enabled 
                  ? `Enabled (${policy.compression.strategy}, ${policy.compression.threshold_tokens.toLocaleString()} tokens)` 
                  : 'Disabled';
                const cacheSupport = isCachingSupported(primary) 
                  ? 'Prefix Caching Supported' 
                  : 'Caching Unavailable';

                return (
                  <tr key={model.id} style={{ borderBottom: '1px solid var(--border-color)', fontSize: '13px' }}>
                    <td style={{ padding: '16px 20px', fontWeight: 600 }}>
                      <code style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }}>{model.id}</code>
                    </td>
                    <td style={{ padding: '16px 20px' }}>
                      <span className="badge badge-primary">{primary}</span>
                    </td>
                    <td style={{ padding: '16px 20px' }}>
                      {fallback !== 'None' ? (
                        <span className="badge badge-secondary">{fallback}</span>
                      ) : (
                        <span style={{ color: 'var(--text-subtle)' }}>None</span>
                      )}
                    </td>
                    <td style={{ padding: '16px 20px' }}>
                      <span style={{ color: policy?.compression?.enabled ? 'var(--color-success)' : 'var(--text-subtle)' }}>
                        {comp}
                      </span>
                    </td>
                    <td style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span 
                          className="material-symbols-outlined" 
                          style={{ 
                            fontSize: '16px', 
                            color: isCachingSupported(primary) ? 'var(--color-success)' : 'var(--text-subtle)' 
                          }}
                        >
                          {isCachingSupported(primary) ? 'check_circle' : 'cancel'}
                        </span>
                        <span style={{ color: isCachingSupported(primary) ? 'var(--text-color)' : 'var(--text-subtle)' }}>
                          {cacheSupport}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleConfigure(model)}
                        >
                          Configure
                        </button>
                        {policy && (
                          <button
                            className="btn btn-sm"
                            style={{ background: 'transparent', color: 'var(--color-danger)', border: 'none' }}
                            onClick={() => handleDeletePolicy(model.id)}
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showModal && activeModel && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
        }}>
          <div className="card" style={{ width: '100%', maxWidth: '520px', margin: '20px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Configure Model</h3>
                <code style={{ fontSize: '11px', color: 'var(--text-subtle)', fontFamily: 'var(--font-mono)' }}>{activeModel.id}</code>
              </div>
              <button 
                onClick={() => setShowModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-color)', cursor: 'pointer' }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleSave}>
              <div style={{ marginBottom: '20px' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Routing</h4>
                
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>Fallback Model</label>
                  <select
                    value={fallbackModel}
                    onChange={(e) => setFallbackModel(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-sidebar)',
                      color: 'var(--text-color)',
                      outline: 'none',
                    }}
                  >
                    <option value="">None (Disable Fallback)</option>
                    {models
                      .filter(m => m.id !== activeModel.id)
                      .map(m => (
                        <option key={m.id} value={m.id}>{m.id}</option>
                      ))}
                  </select>
                </div>
                </div>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '20px 0' }} />

              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Compression</h4>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={compEnabled}
                      onChange={(e) => setCompEnabled(e.target.checked)}
                    />
                    Enable compression
                  </label>
                </div>

                {compEnabled && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ gridColumn: 'span 2' }}>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>Compression Trigger</label>
                      <select
                        value={compTrigger}
                        onChange={(e) => setCompTrigger(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-sidebar)',
                          color: 'var(--text-color)',
                          outline: 'none',
                        }}
                      >
                        <option value="threshold">Proactive (Above Threshold Tokens)</option>
                        <option value="context_limit">Reactive (Only when exceeding context limit)</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>Strategy</label>
                      <select
                        value={compStrategy}
                        onChange={(e) => setCompStrategy(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-sidebar)',
                          color: 'var(--text-color)',
                          outline: 'none',
                        }}
                      >
                        <option value="light">Light</option>
                        <option value="balanced">Balanced</option>
                        <option value="aggressive">Aggressive</option>
                        <option value="extreme">Extreme</option>
                      </select>
                    </div>

                    {compTrigger === 'threshold' && (
                      <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>Threshold (tokens)</label>
                        <input
                          type="number"
                          value={compThreshold}
                          onChange={(e) => setCompThreshold(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-sidebar)',
                            color: 'var(--text-color)',
                            outline: 'none',
                          }}
                          min="0"
                          required
                        />
                      </div>
                    )}

                    <div style={{ gridColumn: 'span 2' }}>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '6px' }}>Preserve recent messages</label>
                      <input
                        type="number"
                        value={preserveRecent}
                        onChange={(e) => setPreserveRecent(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-sidebar)',
                          color: 'var(--text-color)',
                          outline: 'none',
                        }}
                        min="0"
                        required
                      />
                    </div>
                  </div>
                )}
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '20px 0' }} />

              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Cache</h4>
                
                {isCachingSupported(primaryProvider) ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: '6px' }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--color-success)', fontSize: '20px' }}>check_circle</span>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-color)' }}>✓ Preserve provider cache</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>Provider: Prefix caching supported natively.</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px' }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--color-danger)', fontSize: '20px' }}>info</span>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-color)' }}>Caching Unavailable</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>Provider caching information unavailable or not natively supported.</div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                >
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
