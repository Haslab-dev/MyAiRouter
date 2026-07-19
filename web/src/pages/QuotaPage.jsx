import { useState, useEffect } from 'react';
import { useSnackbar } from '../stores/snackbar';

export default function QuotaPage() {
  const notify = useSnackbar((s) => s.notify);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchConnections = async () => {
    try {
      const res = await fetch('/api/providers');
      if (res.ok) {
        const data = await res.json();
        setConnections(data || []);
      } else {
        setError('Failed to fetch provider connections');
      }
    } catch (err) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnections();
  }, []);

  const handleToggleActive = async (id, currentActive) => {
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentActive })
      });
      if (res.ok) {
        await fetchConnections();
        notify(`Provider ${currentActive ? 'disabled' : 'enabled'} successfully.`, 'success');
      } else {
        notify('Failed to update provider status.', 'error');
      }
    } catch (err) {
      console.error('Error toggling provider state:', err);
      notify('Error updating provider.', 'error');
    }
  };

  const handleDeleteConnection = async (id) => {
    if (!confirm('Are you sure you want to disconnect this provider?')) return;
    try {
      const res = await fetch(`/api/providers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchConnections();
        notify('Provider connection removed.', 'info');
      } else {
        notify('Failed to remove provider.', 'error');
      }
    } catch (err) {
      console.error('Error deleting provider connection:', err);
      notify('Error removing provider.', 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Node Health & Limits</h1>
          <p className="page-description">Monitor upstream provider rate limits, account quotas, and gateway metrics.</p>
        </div>
        <button className="btn btn-secondary" onClick={fetchConnections} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>refresh</span>
          Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-subtle)' }}>
          Loading provider connection nodes...
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--color-danger)' }}>
          {error}
        </div>
      ) : connections.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--text-subtle)', marginBottom: '12px' }}>health_and_safety</span>
          <h3 style={{ fontWeight: 600, marginBottom: '8px' }}>No Connected Nodes</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Configure access keys in the Providers panel to register connection nodes.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '20px' }}>
          {connections.map((conn) => {
            return (
              <div key={conn.id} className="card" style={{ padding: '20px', border: conn.isActive ? '1px solid var(--color-primary)' : '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ 
                      width: '32px', 
                      height: '32px', 
                      borderRadius: '6px', 
                      background: conn.isActive ? 'var(--color-primary)' : 'var(--text-subtle)', 
                      color: 'var(--bg-color)',
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      fontFamily: 'var(--font-sans)',
                      fontSize: '14px'
                    }}>
                      {conn.provider.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '15px' }}>{conn.provider.toUpperCase()}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{conn.name || conn.email || 'Unnamed Key'}</div>
                    </div>
                  </div>

                  {/* Controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button 
                      onClick={() => handleDeleteConnection(conn.id)} 
                      className="btn btn-secondary" 
                      style={{ padding: '6px', color: 'var(--color-danger)', border: '1px solid rgba(255,90,103,0.15)', background: 'transparent' }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                    </button>
                    <label className="switch">
                      <input 
                        type="checkbox" 
                        checked={conn.isActive} 
                        onChange={() => handleToggleActive(conn.id, conn.isActive)}
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>

                {/* Gateway priority & status details */}
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className={`badge ${conn.isActive ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '11px', textTransform: 'capitalize' }}>
                      ● {conn.isActive ? 'Healthy' : 'Inactive'}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                      Priority Layer: <strong>Level {conn.priority}</strong>
                    </span>
                  </div>

                  {/* Gateway capacity constraints */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-subtle)', marginBottom: '4px' }}>
                      <span>Rate Limit (gateway middleware capacity)</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>60 requests / min</span>
                    </div>
                    <div style={{ height: '6px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: conn.isActive ? '15%' : '0%', height: '100%', background: 'var(--color-primary)' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
