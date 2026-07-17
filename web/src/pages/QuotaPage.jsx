import { useState } from 'react';

export default function QuotaPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showEmpty, setShowEmpty] = useState(false);
  const [showAvailable, setShowAvailable] = useState(true);

  // Replicating mock quota items from screenshot
  const quotas = [
    {
      id: 'glm-quota',
      provider: 'Glm',
      accountName: 'KantorKey',
      logo: 'Z', // GLM Coding icon letter
      color: '#000000',
      limits: [
        {
          name: 'session',
          used: 2,
          limit: 100,
          unit: '',
          percent: 98,
          expiresIn: 'in 1h 59m',
        }
      ]
    }
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Quota Tracker</h1>
          <p className="page-description">Track and manage your API quota limits</p>
        </div>
      </div>

      {/* Filter and Control Bar matching screenshot */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '12px', 
        marginBottom: '24px', 
        flexWrap: 'wrap',
        background: 'var(--bg-card)',
        padding: '12px 16px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)'
      }}>
        <select className="input-field" style={{ width: 'auto', padding: '6px 12px', fontSize: '13px' }}>
          <option>All Providers</option>
        </select>

        <select className="input-field" style={{ width: 'auto', padding: '6px 12px', fontSize: '13px' }}>
          <option>All accounts</option>
        </select>

        <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>hourglass_empty</span>
          Expiring first
        </button>

        <button 
          onClick={() => setShowEmpty(!showEmpty)}
          className={`btn ${showEmpty ? 'btn-primary' : 'btn-secondary'}`} 
          style={{ 
            padding: '6px 12px', 
            fontSize: '13px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            color: showEmpty ? '#fff' : 'var(--color-danger)',
            borderColor: showEmpty ? 'var(--color-primary)' : 'rgba(239, 68, 68, 0.2)',
            background: showEmpty ? 'var(--color-primary)' : 'rgba(239, 68, 68, 0.05)'
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>block</span>
          Turn off Empty
        </button>

        <button 
          onClick={() => setShowAvailable(!showAvailable)}
          className={`btn ${showAvailable ? 'btn-primary' : 'btn-secondary'}`} 
          style={{ 
            padding: '6px 12px', 
            fontSize: '13px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            color: showAvailable ? '#fff' : 'var(--color-success)',
            borderColor: showAvailable ? 'var(--color-primary)' : 'rgba(16, 185, 129, 0.2)',
            background: showAvailable ? 'var(--color-primary)' : 'rgba(16, 185, 129, 0.05)'
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>check_circle</span>
          Turn on Available
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
          <button 
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="btn btn-secondary" 
            style={{ padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span className="switch" style={{ width: '32px', height: '16px', display: 'inline-block' }}>
              <input type="checkbox" checked={autoRefresh} onChange={() => {}} />
              <span className="slider" style={{ before: { width: '10px', height: '10px' } }}></span>
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Auto-refresh (55s)</span>
          </button>

          <button className="btn btn-secondary" style={{ padding: '6px', borderRadius: '50%' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>refresh</span>
          </button>
        </div>
      </div>

      {/* Quota Cards List */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '20px' }}>
        {quotas.map((q) => (
          <div key={q.id} className="card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ 
                  width: '32px', 
                  height: '32px', 
                  borderRadius: '6px', 
                  background: 'var(--text-main)', 
                  color: 'var(--bg-color)',
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '14px'
                }}>
                  {q.logo}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '15px' }}>{q.provider}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{q.accountName}</div>
                </div>
              </div>

              {/* Action Buttons inside Card */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button className="btn btn-secondary" style={{ padding: '6px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>refresh</span>
                </button>
                <button className="btn btn-secondary" style={{ padding: '6px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
                </button>
                <button className="btn btn-secondary" style={{ padding: '6px', color: 'var(--color-danger)' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                </button>
                <label className="switch" style={{ width: '36px', height: '20px' }}>
                  <input type="checkbox" defaultChecked />
                  <span className="slider"></span>
                </label>
              </div>
            </div>

            {/* Limits Progress Section */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              {q.limits.map((l, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className="badge badge-success" style={{ fontSize: '11px', textTransform: 'capitalize' }}>
                    ● {l.name}
                  </span>
                  
                  <div style={{ flexGrow: 1, position: 'relative' }}>
                    <div style={{ height: '6px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${l.percent}%`, height: '100%', background: 'var(--color-success)' }}></div>
                    </div>
                  </div>

                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-success)', fontFamily: 'var(--font-mono)' }}>
                    {l.percent}%
                  </span>

                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '70px', textAlign: 'right' }}>
                    {l.expiresIn}
                  </span>

                  <button className="btn btn-secondary" style={{ padding: '4px', border: 'none', background: 'transparent' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--text-subtle)' }}>visibility_off</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
