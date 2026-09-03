import { useState } from 'react';

export default function ToolCallCard({ toolCall, result, isExecuting }) {
  const [isOpen, setIsOpen] = useState(false);
  const fn = toolCall?.function || {};
  const argsStr = fn.arguments || '{}';

  let parsedArgs;
  try {
    parsedArgs = JSON.parse(argsStr);
  } catch {
    parsedArgs = argsStr;
  }

  const toolIcons = {
    web_search: 'search',
    web_fetch: 'language',
    calculate: 'calculate',
    get_time: 'schedule',
  };

  return (
    <div style={{
      margin: '8px 0',
      borderRadius: '8px',
      border: '1px solid var(--border-color)',
      overflow: 'hidden',
      background: 'rgba(255,255,255,0.02)'
    }}>
      <button
        onClick={() => result && setIsOpen(!isOpen)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          cursor: result ? 'pointer' : 'default',
          fontSize: '12px',
          textAlign: 'left'
        }}
      >
        <span className="material-symbols-outlined" style={{
          fontSize: '16px',
          color: isExecuting ? 'var(--color-primary)' : result ? '#3fb950' : 'var(--text-muted)'
        }}>
          {isExecuting ? 'progress_activity' : 'check_circle'}
        </span>
        <span className="material-symbols-outlined" style={{ fontSize: '15px', color: 'var(--color-primary)' }}>
          {toolIcons[fn.name] || 'build'}
        </span>
        <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
          {fn.name}
        </span>
        {typeof parsedArgs === 'object' && parsedArgs !== null && (
          <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
            {Object.entries(parsedArgs).map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v.slice(0, 30)}"` : v}`).join(' ')}
          </span>
        )}
        {isExecuting && (
          <span style={{ color: 'var(--text-muted)', fontSize: '11px', marginLeft: 'auto' }}>Executing...</span>
        )}
        {!isExecuting && result && (
          <span className="material-symbols-outlined" style={{
            fontSize: '14px',
            color: 'var(--text-muted)',
            marginLeft: 'auto',
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease'
          }}>
            expand_more
          </span>
        )}
      </button>

      {isOpen && result && (
        <div style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border-color)',
          maxHeight: '200px',
          overflowY: 'auto',
          background: 'rgba(0,0,0,0.15)'
        }}>
          <pre style={{
            margin: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            color: 'var(--text-muted)'
          }}>
            {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
