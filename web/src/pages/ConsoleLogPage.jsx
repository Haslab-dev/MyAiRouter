import { useState, useEffect, useRef } from 'react';

export default function ConsoleLogPage() {
  const [logs, setLogs] = useState([]);
  const [isPaused, setIsPaused] = useState(false);
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

  const handleCopyToClipboard = () => {
    const text = (logs || []).join('\n');
    navigator.clipboard.writeText(text);
    alert('Logs copied to clipboard!');
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      {/* Header section matching template layout */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexShrink: 0 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined text-primary" style={{ fontSize: '28px' }}>insights</span>
            Traffic Logs
          </h1>
          <p className="page-description">Real-time request stream and console output from the active myAiRouter daemon process.</p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
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
            Clear Screen
          </button>
          <button 
            onClick={handleCopyToClipboard} 
            className="btn btn-primary" 
            style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>content_copy</span>
            Copy Trace
          </button>
        </div>
      </div>

      {/* Monospace terminal body */}
      <div style={{
        flexGrow: 1,
        background: '#0c1017',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        padding: '20px',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        color: '#E1E7EF', 
        overflowY: 'auto',
        boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.6)',
        lineHeight: '1.6'
      }}>
        {logs.length === 0 ? (
          <div style={{ color: 'var(--text-subtle)', textAlign: 'center', paddingTop: '40px' }}>
            No logs captured yet. Execute API queries to start stream output...
          </div>
        ) : (
          logs.map((log, index) => (
            <div key={index} style={{ display: 'flex', gap: '12px', borderBottom: '1px solid rgba(255,255,255,0.01)', padding: '4px 0' }}>
              <span style={{ color: 'var(--text-subtle)', userSelect: 'none', width: '32px', textAlign: 'right' }}>{index + 1}</span>
              <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{log}</span>
            </div>
          ))
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}
