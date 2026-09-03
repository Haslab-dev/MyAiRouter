import { useState } from 'react';

export default function CodeBlock({ language, children }) {
  const [copied, setCopied] = useState(false);
  const code = String(children).replace(/\n$/, '');

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      margin: '12px 0',
      borderRadius: '8px',
      overflow: 'hidden',
      border: '1px solid var(--border-color)',
      background: '#161b22'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 12px',
        background: '#21262d',
        fontSize: '11px',
        color: '#8b949e',
        fontFamily: 'var(--font-mono)'
      }}>
        <span>{language}</span>
        <button
          onClick={handleCopy}
          style={{
            background: 'transparent',
            border: 'none',
            color: copied ? '#3fb950' : '#8b949e',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            transition: 'color 0.15s ease'
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
            {copied ? 'check' : 'content_copy'}
          </span>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre style={{
        padding: '12px 16px',
        margin: 0,
        fontSize: '13px',
        fontFamily: 'var(--font-mono)',
        color: '#c9d1d9',
        overflowX: 'auto',
        lineHeight: '1.5'
      }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
