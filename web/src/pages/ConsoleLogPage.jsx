import { useState, useEffect, useRef } from 'react';

const MAX_LENGTH = 150;

const truncate = (str, max = MAX_LENGTH) => {
  if (!str) return '';
  if (str.length <= max) return str;
  const half = Math.floor((max - 10) / 2);
  return str.slice(0, half) + '............' + str.slice(-half);
};

const formatTimestamp = (ts) => {
  if (!ts) return '';
  const parts = ts.split(' ');
  if (parts.length >= 2) return parts[1];
  return ts;
};

function LogEntry({ entry }) {
  const [expanded, setExpanded] = useState(false);
  const isRequest = entry.type === 'request';
  const isError = entry.type === 'error' || entry.status >= 400;
  const isSystem = entry.type === 'system';

  const statusColor = isError ? 'var(--color-danger)' : 'var(--color-success)';
  const methodColor = {
    'GET': '#10b981',
    'POST': '#3b82f6',
    'PUT': '#f59e0b',
    'PATCH': '#8b5cf6',
    'DELETE': '#ef4444',
  }[entry.method] || 'var(--text-muted)';

  if (isSystem) {
    return (
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-color)',
        background: 'rgba(0,0,0,0.02)',
      }}>
        <span style={{ color: 'var(--text-subtle)', fontSize: '10px' }}>{formatTimestamp(entry.timestamp)}</span>
        <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>{entry.message}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-color)',
        background: 'rgba(220, 38, 38, 0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: 'var(--text-subtle)', fontSize: '10px' }}>{formatTimestamp(entry.timestamp)}</span>
          <span style={{ color: 'var(--color-danger)', fontSize: '11px', fontWeight: 600 }}>ERROR</span>
        </div>
        <div style={{ color: 'var(--color-danger)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
          {truncate(entry.error || entry.message || 'Unknown error')}
        </div>
      </div>
    );
  }

  if (!isRequest) return null;

  return (
    <div style={{
      padding: '10px 12px',
      borderBottom: '1px solid var(--border-color)',
      background: expanded ? 'rgba(0,0,0,0.03)' : 'transparent',
      cursor: 'pointer',
    }}
    onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span style={{ color: 'var(--text-subtle)', fontSize: '10px' }}>{formatTimestamp(entry.timestamp)}</span>
        <span style={{
          color: methodColor,
          fontSize: '11px',
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
        }}>{entry.method}</span>
        <span style={{
          color: 'var(--text-main)',
          fontSize: '12px',
          fontFamily: 'var(--font-mono)',
        }}>{entry.path}</span>
        <span style={{
          color: statusColor,
          fontSize: '10px',
          fontWeight: 600,
          background: statusColor + '15',
          padding: '1px 6px',
          borderRadius: '4px',
        }}>{entry.status || '---'}</span>
        {entry.duration && (
          <span style={{ color: 'var(--text-subtle)', fontSize: '10px' }}>{entry.duration}</span>
        )}
      </div>

      {entry.from && (
        <div style={{ fontSize: '10px', color: 'var(--text-subtle)', marginBottom: '4px' }}>
          from: {entry.from}
        </div>
      )}

      {entry.error && isError && (
        <div style={{
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-danger)',
          background: 'rgba(220, 38, 38, 0.08)',
          padding: '4px 8px',
          borderRadius: '4px',
          marginBottom: '4px',
          border: '1px solid rgba(220, 38, 38, 0.2)',
        }}>
          ERROR: {entry.error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px' }}>
        {entry.req_body && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <span style={{ color: 'var(--text-subtle)', minWidth: '40px' }}>REQ:</span>
            <span style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
              {expanded ? entry.req_body : truncate(entry.req_body)}
            </span>
          </div>
        )}
        {entry.resp_body && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <span style={{ color: 'var(--text-subtle)', minWidth: '40px' }}>RESP:</span>
            <span style={{ color: isError ? 'var(--color-danger)' : 'var(--color-success)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
              {expanded ? entry.resp_body : truncate(entry.resp_body)}
            </span>
          </div>
        )}
      </div>

      <div style={{ fontSize: '10px', color: 'var(--text-subtle)', marginTop: '4px' }}>
        {expanded ? '▲ click to collapse' : '▼ click to expand'}
      </div>
    </div>
  );
}

export default function ConsoleLogPage() {
  const [logs, setLogs] = useState([]);
  const [isPaused, setIsPaused] = useState(false);
  const [filter, setFilter] = useState('all');
  const terminalEndRef = useRef(null);

  const fetchLogs = async () => {
    if (isPaused) return;
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Error fetching server logs:', err);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [isPaused]);

  useEffect(() => {
    if (!isPaused && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isPaused]);

  const handleClearLogs = async () => {
    try {
      await fetch('/api/logs', { method: 'DELETE' });
      setLogs([]);
    } catch (err) {
      console.error('Error clearing logs:', err);
    }
  };

  const handleCopyToClipboard = () => {
    const text = logs.map(l => {
      if (l.type === 'request') {
        return `[${l.timestamp}] ${l.method} ${l.path} ${l.status || ''} ${l.duration || ''}\nREQ: ${l.req_body || ''}\nRESP: ${l.resp_body || ''}`;
      }
      return `[${l.timestamp}] ${l.type === 'error' ? 'ERROR: ' : ''}${l.error || l.message || ''}`;
    }).join('\n\n');
    navigator.clipboard.writeText(text);
  };

  const filteredLogs = logs.filter(l => {
    if (filter === 'all') return true;
    if (filter === 'errors') return l.type === 'error' || l.status >= 400;
    if (filter === 'requests') return l.type === 'request';
    if (filter === 'system') return l.type === 'system';
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexShrink: 0 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined text-primary" style={{ fontSize: '28px' }}>insights</span>
            Traffic Logs
          </h1>
          <p className="page-description">{logs.length} entries captured</p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ display: 'flex', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '2px' }}>
            {['all', 'requests', 'errors', 'system'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: filter === f ? 'var(--color-primary)' : 'transparent',
                  color: filter === f ? '#fff' : 'var(--text-muted)',
                  transition: 'all 0.15s',
                }}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            onClick={() => setIsPaused(!isPaused)}
            className="btn btn-secondary"
            style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
              {isPaused ? 'play_arrow' : 'pause'}
            </span>
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={handleClearLogs}
            className="btn btn-secondary"
            style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
            Clear
          </button>
          <button
            onClick={handleCopyToClipboard}
            className="btn btn-primary"
            style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>content_copy</span>
            Copy
          </button>
        </div>
      </div>

      <div style={{
        flexGrow: 1,
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {filteredLogs.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)' }}>
            {filter === 'errors' ? 'No errors captured' : filter === 'requests' ? 'No requests logged' : 'No logs captured yet'}
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filteredLogs.map((entry, index) => (
              <LogEntry key={entry.id || index} entry={entry} />
            ))}
          </div>
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}
