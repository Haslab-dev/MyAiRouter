import { useState, useEffect } from 'react';

export default function ThinkingSection({ reasoning, isThinking, durationSec }) {
  const [isOpen, setIsOpen] = useState(isThinking);

  useEffect(() => {
    if (isThinking) setIsOpen(true);
  }, [isThinking]);

  if (!reasoning && !isThinking) return null;

  return (
    <div style={{
      margin: '8px 0 14px 0',
      borderRadius: '8px',
      border: '1px solid var(--border-color)',
      background: 'rgba(255, 255, 255, 0.02)',
      overflow: 'hidden'
    }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: '12px',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isThinking ? (
            <span className="material-symbols-outlined spin" style={{ fontSize: '16px', color: 'var(--color-primary)' }}>
              progress_activity
            </span>
          ) : (
            <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-primary)' }}>
              psychology
            </span>
          )}
          <span style={{ fontWeight: 600, color: isThinking ? 'var(--color-primary)' : 'var(--text-muted)' }}>
            {isThinking ? 'Thinking...' : `Thought for ${durationSec ? durationSec.toFixed(1) : 0}s`}
          </span>
        </div>
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: '16px',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }}
        >
          expand_more
        </span>
      </button>

      {isOpen && (
        <div style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--border-color)',
          fontSize: '12.5px',
          lineHeight: '1.55',
          color: 'var(--text-muted)',
          fontStyle: 'italic',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: 'rgba(0, 0, 0, 0.15)',
          maxHeight: '320px',
          overflowY: 'auto'
        }}>
          {reasoning || (isThinking ? 'Analyzing context and formulating response...' : '')}
        </div>
      )}
    </div>
  );
}
