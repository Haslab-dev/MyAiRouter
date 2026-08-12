import { useState, useEffect } from 'react';
import { useSnackbar } from '../stores/snackbar';

const STRATEGY_DETAILS = {
  fallback: {
    label: 'Fallback Chain',
    tokenTag: '1x Tokens (Lowest)',
    badgeClass: 'badge-primary',
    desc: 'Tries models sequentially. Moves to next model only if primary fails. Recommended best default.',
  },
  smart: {
    label: 'Smart Route',
    tokenTag: '1x Tokens (Best Overall)',
    badgeClass: 'badge-success',
    desc: 'Classifies prompt intent (coding, translation, long context, math, chat) to choose optimal model first.',
  },
  load_balance: {
    label: 'Load Balance',
    tokenTag: '1x Tokens (Operational)',
    badgeClass: 'badge-info',
    desc: 'Distributes requests round-robin across target models to bypass quota bottlenecks.',
  },
  progressive: {
    label: 'Progressive Routing',
    tokenTag: '1x-2x Tokens (Escalation)',
    badgeClass: 'badge-warning',
    desc: 'Queries fast/cheap model first; runs confidence check on output and escalates to premium model if needed.',
  },
  race: {
    label: 'Race (Hedged)',
    tokenTag: 'Low Latency (Speculative)',
    badgeClass: 'badge-accent',
    desc: 'Launches primary model; if slow after 400ms, starts secondary model. First response wins.',
  },
  parallel: {
    label: 'Parallel Execution',
    tokenTag: 'Multi-Model Tokens',
    badgeClass: 'badge-secondary',
    desc: 'Dispatches prompt to all models simultaneously and returns the fastest successful response.',
  },
  ensemble: {
    label: 'Ensemble Synthesis',
    tokenTag: 'High Quality (Consensus)',
    badgeClass: 'badge-danger',
    desc: 'Queries all models concurrently and synthesizes consensus output for maximum quality.',
  },
};

export default function CombosPage() {
  const notify = useSnackbar((s) => s.notify);
  const [combos, setCombos] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editCombo, setEditCombo] = useState(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('fallback');
  const [selectedModels, setSelectedModels] = useState([]);
  const [availableModels, setAvailableModels] = useState({});

  useEffect(() => {
    fetchCombos();
    fetchAvailableModels();
  }, []);

  const fetchCombos = async () => {
    const res = await fetch('/api/combos');
    if (res.ok) setCombos(await res.json());
  };

  const fetchAvailableModels = async () => {
    try {
      const res = await fetch('/v1/models');
      if (!res.ok) return;
      const json = await res.json();
      const models = json.data || [];
      const grouped = {};
      for (const m of models) {
        const prov = m.owned_by;
        if (!grouped[prov]) grouped[prov] = [];
        grouped[prov].push(m);
      }
      setAvailableModels(grouped);
    } catch (err) {
      console.error('Error fetching available models:', err);
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

  const handleEdit = (combo) => {
    setEditCombo(combo);
    setName(combo.name);
    setKind(combo.kind || 'fallback');
    setSelectedModels(combo.models || []);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || selectedModels.length === 0) return;

    const payload = {
      name: name.trim(),
      kind,
      models: selectedModels,
    };

    if (editCombo) {
      const res = await fetch(`/api/combos?id=${editCombo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        notify('Route updated successfully!', 'success');
      } else {
        notify('Failed to update route.', 'error');
      }
    } else {
      const res = await fetch('/api/combos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        notify('Route saved successfully!', 'success');
      } else {
        notify('Failed to save route.', 'error');
      }
    }

    setName('');
    setKind('fallback');
    setSelectedModels([]);
    setShowForm(false);
    setEditCombo(null);
    await fetchCombos();
  };

  const moveModel = (fromIdx, toIdx) => {
    const updated = [...selectedModels];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    setSelectedModels(updated);
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
          <p className="page-description">Configure intelligent routing strategies, request fallback chains, and speculative model routing.</p>
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
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="e.g. my-smart-route" required />
              </div>
              <div style={{ flex: 1 }}>
                <label className="form-label">Strategy Algorithm</label>
                <select value={kind} onChange={(e) => setKind(e.target.value)} className="input-field">
                  {Object.entries(STRATEGY_DETAILS)
                    .filter(([key]) => !['smart', 'race', 'parallel', 'ensemble'].includes(key))
                    .map(([key, info]) => (
                      <option key={key} value={key}>
                        {info.label} ({info.tokenTag})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {STRATEGY_DETAILS[kind] && (
              <div style={{ padding: '10px 14px', background: 'var(--bg-sidebar)', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '16px', fontSize: '12px', color: 'var(--text-subtle)' }}>
                <strong style={{ color: 'var(--text-main)' }}>{STRATEGY_DETAILS[kind].label}</strong> — {STRATEGY_DETAILS[kind].desc}
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              <label className="form-label">Available Models</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                {Object.entries(availableModels || {}).map(([prov, models]) =>
                  (models || []).map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => addModel(m.id)}
                      disabled={selectedModels.includes(m.id)}
                      className="btn btn-secondary"
                      style={{ fontSize: '11px', padding: '4px 10px', opacity: selectedModels.includes(m.id) ? 0.4 : 1 }}
                    >
                      {m.id}
                    </button>
                  ))
                )}
              </div>

              {selectedModels && selectedModels.length > 0 && (
                <>
                  <label className="form-label">Target Model Priority Order (top = tried first)</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {selectedModels.map((m, i) => (
                      <div key={m} draggable="true"
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(i)); e.currentTarget.style.opacity = '0.5'; }}
                        onDragEnd={(e) => { e.currentTarget.style.opacity = '1'; }}
                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
                        onDragLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.currentTarget.style.borderColor = 'var(--border-color)';
                          const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
                          const toIdx = i;
                          if (fromIdx !== toIdx) { moveModel(fromIdx, toIdx); }
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'var(--bg-sidebar)', borderRadius: '8px', border: '1px solid var(--border-color)', cursor: 'grab' }}>
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
              <button type="submit" className="btn btn-primary" disabled={!name.trim() || !selectedModels || selectedModels.length === 0}>{editCombo ? 'Update Route' : 'Save Route'}</button>
              <button type="button" onClick={() => { setShowForm(false); setSelectedModels([]); setName(''); setEditCombo(null); }} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {!combos || combos.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--text-subtle)', marginBottom: '12px' }}>alt_route</span>
          <h3 style={{ fontWeight: 600, marginBottom: '8px' }}>No Active Routes</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Create a route to chain backup provider models or optimize token efficiency with smart routing strategies.</p>
        </div>
      ) : (
        (combos || []).map(combo => {
          const strat = STRATEGY_DETAILS[combo.kind] || STRATEGY_DETAILS.fallback;
          return (
            <div key={combo.id} className="card" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className={`badge ${strat.badgeClass || 'badge-primary'}`}>
                    {strat.label}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-subtle)', padding: '2px 6px', background: 'var(--bg-sidebar)', borderRadius: '4px' }}>
                    {strat.tokenTag}
                  </span>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, marginLeft: '4px' }}>{combo.name}</h3>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => handleEdit(combo)} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '11px' }}>Edit</button>
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
          );
        })
      )}
    </div>
  );
}

