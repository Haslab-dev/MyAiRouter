import { useState, useEffect } from 'react';
import { useSnackbar } from '../stores/snackbar';

export default function CombosPage() {
  const notify = useSnackbar((s) => s.notify);
  const [combos, setCombos] = useState([]);
  const [providers, setProviders] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editCombo, setEditCombo] = useState(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('fallback');
  const [selectedModels, setSelectedModels] = useState([]);
  const [availableModels, setAvailableModels] = useState({});

  useEffect(() => {
    fetchCombos();
    fetchProviders();
  }, []);

  const fetchCombos = async () => {
    const res = await fetch('/api/combos');
    if (res.ok) setCombos(await res.json());
  };

  const fetchProviders = async () => {
    const [connRes, nodeRes] = await Promise.all([
      fetch('/api/providers'),
      fetch('/api/provider-nodes'),
    ]);
    const conns = connRes.ok ? await connRes.json() : [];
    const nodes = nodeRes.ok ? (await nodeRes.json()).nodes || [] : [];

    const models = {};
    const builtin = {
      kilocode: ['anthropic/claude-sonnet-4-20250514', 'anthropic/claude-opus-4-20250514', 'google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'openai/gpt-4.1', 'openai/o3', 'deepseek/deepseek-chat', 'deepseek/deepseek-reasoner'],
      'opencode-go': ['glm-5.2', 'glm-5.1', 'kimi-k2.7-code', 'kimi-k2.6', 'deepseek-v4-pro', 'deepseek-v4-flash', 'mimo-v2.5', 'mimo-v2.5-pro', 'minimax-m3', 'minimax-m2.7', 'qwen3.7-max', 'qwen3.7-plus'],
      'opencode-zen': ['glm-5.2', 'kimi-k2.7-code', 'deepseek-v4-pro', 'qwen3.7-max'],
      glm: ['glm-4', 'glm-4v', 'glm-3-turbo'],
      'glm-coding': ['codegeex-4'],
    };

    conns.forEach(c => {
      if (c.isActive) {
        models[c.provider] = (builtin[c.provider] || []).map(m => ({ provider: c.provider, id: m }));
      }
    });
    nodes.forEach(n => {
      models[n.id] = [{ provider: n.id, id: '* (passthrough)' }];
    });

    setProviders(conns.filter(c => c.isActive));
    setAvailableModels(models);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || selectedModels.length === 0) return;

    const payload = {
      name: name.trim(),
      kind,
      models: selectedModels,
    };

    const res = await fetch('/api/combos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setName('');
      setKind('fallback');
      setSelectedModels([]);
      setShowForm(false);
      setEditCombo(null);
      await fetchCombos();
      notify('Route saved successfully!', 'success');
    } else {
      notify('Failed to save route.', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this combo?')) return;
    const res = await fetch(`/api/combos?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      await fetchCombos();
      notify('Route deleted.', 'info');
    } else {
      notify('Failed to delete route.', 'error');
    }
  };

  const addModel = (modelId) => {
    if (!selectedModels.includes(modelId)) {
      setSelectedModels([...selectedModels, modelId]);
    }
  };

  const removeModel = (modelId) => {
    setSelectedModels(selectedModels.filter(m => m !== modelId));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined text-primary" style={{ fontSize: '28px' }}>alt_route</span>
            Active Routes
          </h1>
          <p className="page-description">Configure request fallback routes and target node priority groups for upstream redundancy.</p>
        </div>
        <button onClick={() => { setShowForm(!showForm); setEditCombo(null); }} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
          New Route
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 className="card-title">{editCombo ? 'Edit Route' : 'Register Custom Route'}</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">Route Key</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="e.g. my-fallback-chain" required />
              </div>
              <div style={{ width: '160px' }}>
                <label className="form-label">Strategy</label>
                <select value={kind} onChange={(e) => setKind(e.target.value)} className="input-field">
                  <option value="fallback">Fallback Chain</option>
                  <option value="parallel">Parallel (future)</option>
                  <option value="ensemble">Ensemble (future)</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label className="form-label">Available Models</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                {Object.entries(availableModels || {}).map(([prov, models]) =>
                  (models || []).map(m => (
                    <button
                      key={`${prov}/${m.id}`}
                      type="button"
                      onClick={() => addModel(`${prov}/${m.id}`)}
                      disabled={selectedModels.includes(`${prov}/${m.id}`)}
                      className="btn btn-secondary"
                      style={{ fontSize: '11px', padding: '4px 10px', opacity: selectedModels.includes(`${prov}/${m.id}`) ? 0.4 : 1 }}
                    >
                      {prov}/{m.id}
                    </button>
                  ))
                )}
              </div>

              {selectedModels && selectedModels.length > 0 && (
                <>
                  <label className="form-label">Chain Order (top = tried first)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {selectedModels.map((m, i) => (
                      <div key={m} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'var(--bg-sidebar)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '14px', color: 'var(--text-subtle)' }}>drag_indicator</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-subtle)', minWidth: '20px' }}>#{i + 1}</span>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 600 }}>{m}</code>
                        <button type="button" onClick={() => removeModel(m)} className="btn" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: '11px', color: 'var(--color-danger)', background: 'transparent', border: '1px solid rgba(239,68,68,0.2)' }}>Remove</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button type="submit" className="btn btn-primary" disabled={!name.trim() || !selectedModels || selectedModels.length === 0}>Save Route</button>
              <button type="button" onClick={() => { setShowForm(false); setSelectedModels([]); setName(''); }} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {!combos || combos.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--text-subtle)', marginBottom: '12px' }}>alt_route</span>
          <h3 style={{ fontWeight: 600, marginBottom: '8px' }}>No Active Routes</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Create a fallback route to chain backup provider models when your primary choices are slow or failing.</p>
        </div>
      ) : (
        (combos || []).map(combo => (
          <div key={combo.id} className="card" style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="badge badge-primary" style={{ textTransform: 'capitalize' }}>{combo.kind || 'fallback'}</span>
                <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>{combo.name}</h3>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => handleDelete(combo.id)} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.2)' }}>Delete</button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {(combo.models || []).map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', padding: '4px 8px', background: 'var(--bg-sidebar)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>{m}</code>
                  {i < (combo.models || []).length - 1 && (
                    <span className="material-symbols-outlined" style={{ fontSize: '14px', color: 'var(--text-subtle)' }}>arrow_forward</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
