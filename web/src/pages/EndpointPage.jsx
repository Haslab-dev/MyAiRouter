import { useState, useEffect } from 'react';

export default function EndpointPage() {
  const [keys, setKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [copiedKeyId, setCopiedKeyId] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchKeys = async () => {
    try {
      const res = await fetch('/api/keys');
      if (res.ok) {
        const data = await res.json();
        setKeys(data || []);
      }
    } catch (err) {
      console.error('Error fetching API keys:', err);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreateKey = async (e) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName }),
      });

      if (res.ok) {
        setNewKeyName('');
        fetchKeys();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create key');
      }
    } catch (err) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteKey = async (id) => {
    if (!confirm('Are you sure you want to delete this API key? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/keys?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchKeys();
      }
    } catch (err) {
      console.error('Error deleting key:', err);
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Endpoint & Keys</h1>
          <p className="page-description">Configure your developer client and authenticate with the local AI gateway.</p>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">
          <span className="material-symbols-outlined text-primary">hub</span>
          Connection Settings
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '16px' }}>
          <div>
            <label className="form-label">API Gateway Base URL</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input 
                type="text" 
                readOnly 
                value="http://localhost:20128/v1" 
                className="input-field" 
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              <button 
                onClick={() => copyToClipboard('http://localhost:20128/v1', 'base_url')}
                className="btn btn-secondary"
              >
                {copiedKeyId === 'base_url' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div>
            <label className="form-label">Health Check URL</label>
            <input 
              type="text" 
              readOnly 
              value="http://localhost:20128/api/health" 
              className="input-field"
              style={{ fontFamily: 'var(--font-mono)', opacity: 0.7 }}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">
          <span className="material-symbols-outlined text-primary">key</span>
          Developer API Keys
        </h2>
        <p className="page-description" style={{ marginBottom: '20px' }}>
          Create local authentication tokens to connect your CLI, code extensions, or custom SDK clients.
        </p>

        <form onSubmit={handleCreateKey} style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
          <input
            type="text"
            placeholder="Key name (e.g. VS Code, Cline, Cursor)"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="input-field"
            disabled={loading}
            style={{ maxWidth: '400px' }}
          />
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Creating...' : 'Create Key'}
          </button>
        </form>

        {error && <p style={{ color: 'var(--color-danger)', marginBottom: '16px', fontSize: '13px' }}>{error}</p>}

        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>API Key</th>
                <th>Created</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-subtle)', padding: '24px' }}>
                    No API keys created yet. Generate one above to get started.
                  </td>
                </tr>
              ) : (
                keys.map((k) => (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 600 }}>{k.name || 'Unnamed Key'}</td>
                    <td>
                      <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{k.key}</code>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {new Date(k.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      <span className="badge badge-success">Active</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '8px' }}>
                        <button 
                          onClick={() => copyToClipboard(k.key, k.id)}
                          className="btn btn-secondary" 
                          style={{ padding: '6px 12px', fontSize: '11px' }}
                        >
                          {copiedKeyId === k.id ? 'Copied!' : 'Copy'}
                        </button>
                        <button 
                          onClick={() => handleDeleteKey(k.id)}
                          className="btn btn-danger" 
                          style={{ padding: '6px 12px', fontSize: '11px', backgroundColor: 'transparent', color: 'var(--color-danger)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
