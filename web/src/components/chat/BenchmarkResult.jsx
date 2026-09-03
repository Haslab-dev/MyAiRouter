import { useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';

function MetricBadge({ label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: color || 'var(--text-main)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{value}</span>
    </div>
  );
}

export default function BenchmarkResult({ result, onImageClick }) {
  const [expanded, setExpanded] = useState(true);
  const [showThinking, setShowThinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const r = result;

  const latencyMs = r.latency || 0;
  const tokensPerSec = r.tokensPerSec || 0;
  const inputTokens = r.inputTokens || 0;
  const outputTokens = r.outputTokens || 0;
  const cacheTokens = r.cacheTokens || 0;
  const hasReasoning = r.reasoning && r.reasoning.length > 0;

  const handleCopy = () => {
    navigator.clipboard.writeText(r.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      borderRadius: '8px',
      border: '1px solid var(--border-color)',
      overflow: 'hidden',
      background: 'var(--bg-card)'
    }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 14px',
          background: r.error ? 'rgba(248,81,73,0.05)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left'
        }}
      >
        {r.isThinking ? (
          <span className="material-symbols-outlined spin" style={{ fontSize: '16px', color: 'var(--color-primary)' }}>psychology</span>
        ) : r.streaming ? (
          <span className="material-symbols-outlined spin" style={{ fontSize: '16px', color: 'var(--color-primary)' }}>progress_activity</span>
        ) : r.error ? (
          <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-danger)' }}>error</span>
        ) : (
          <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#3fb950' }}>check_circle</span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>{r.model}</div>
          <div style={{ display: 'flex', gap: '12px', marginTop: '2px', flexWrap: 'wrap' }}>
            <MetricBadge label="latency" value={`${(latencyMs / 1000).toFixed(2)}s`} color={latencyMs > 5000 ? 'var(--color-warning)' : 'var(--text-main)'} />
            <MetricBadge label="tok/s" value={tokensPerSec.toFixed(1)} color={tokensPerSec > 50 ? '#3fb950' : tokensPerSec > 20 ? 'var(--text-main)' : 'var(--color-warning)'} />
            <MetricBadge label="in" value={inputTokens.toLocaleString()} />
            <MetricBadge label="out" value={outputTokens.toLocaleString()} />
            {cacheTokens > 0 && <MetricBadge label="cache" value={cacheTokens.toLocaleString()} color="#3fb950" />}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          {!r.streaming && r.content && (
            <button
              onClick={(e) => { e.stopPropagation(); handleCopy(); }}
              style={{ background: 'none', border: 'none', color: copied ? '#3fb950' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
              title="Copy output"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>{copied ? 'check' : 'content_copy'}</span>
            </button>
          )}
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: '16px',
              color: 'var(--text-muted)',
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s ease'
            }}
          >
            expand_more
          </span>
        </div>
      </button>

      {/* Content */}
      {expanded && (
        <div style={{
          padding: '0 14px 14px',
          borderTop: '1px solid var(--border-color)',
          maxHeight: '600px',
          overflowY: 'auto'
        }}>
          {/* Thinking/Reasoning */}
          {(r.isThinking || hasReasoning) && (
            <div style={{
              margin: '10px 0',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              overflow: 'hidden',
              background: 'rgba(255,255,255,0.02)'
            }}>
              <button
                onClick={() => setShowThinking(!showThinking)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  background: 'transparent',
                  border: 'none',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {r.isThinking ? (
                    <span className="material-symbols-outlined spin" style={{ fontSize: '14px', color: 'var(--color-primary)' }}>progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined" style={{ fontSize: '14px', color: 'var(--color-primary)' }}>psychology</span>
                  )}
                  <span style={{ fontWeight: 600, color: r.isThinking ? 'var(--color-primary)' : 'var(--text-muted)' }}>
                    {r.isThinking ? 'Thinking...' : `Thought`}
                  </span>
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: '14px', transform: showThinking ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
                  expand_more
                </span>
              </button>
              {showThinking && (
                <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border-color)', fontSize: '12px', lineHeight: '1.5', color: 'var(--text-muted)', fontStyle: 'italic', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'rgba(0,0,0,0.1)', maxHeight: '200px', overflowY: 'auto' }}>
                  {r.reasoning || (r.isThinking ? 'Analyzing...' : '')}
                </div>
              )}
            </div>
          )}

          {/* Response */}
          {r.error ? (
            <div style={{ padding: '12px 0', color: 'var(--color-danger)', fontSize: '13px' }}>{r.error}</div>
          ) : !r.content && r.streaming ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '13px', padding: '12px 0' }}>
              <span className="material-symbols-outlined spin" style={{ fontSize: '16px', color: 'var(--color-primary)' }}>progress_activity</span>
              {r.isThinking ? 'Thinking...' : 'Generating...'}
            </div>
          ) : r.content ? (
            <div style={{ paddingTop: '8px' }}>
              <MarkdownRenderer content={r.content} onImageClick={onImageClick} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
