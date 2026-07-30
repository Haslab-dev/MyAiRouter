import { useState, useEffect } from 'react';
import { useSnackbar } from '../stores/snackbar';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtLatency(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function fmtTokens(n) {
  if (!n && n !== 0) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

function fmtCost(c) {
  if (c === undefined || c === null) return '$0.0000';
  return `$${Number(c).toFixed(4)}`;
}

function StatusBadge({ status }) {
  const ok = status === 'ok';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      fontSize: '11px', fontWeight: 700, padding: '2px 8px',
      borderRadius: '20px',
      background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
      color: ok ? 'var(--color-success)' : 'var(--color-danger)',
      border: `1px solid ${ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
    }}>
      {ok ? '✔ Success' : '✖ Error'}
    </span>
  );
}

function RouteBadge({ route }) {
  return (
    <span style={{
      fontSize: '9px', padding: '1px 6px', borderRadius: '4px',
      background: 'rgba(139,92,246,0.15)', color: '#a78bfa',
      border: '1px solid rgba(139,92,246,0.25)',
      textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.5px',
    }}>
      {route || 'direct'}
    </span>
  );
}

// ─── list card ────────────────────────────────────────────────────────────────

function TraceListCard({ trace, isSelected, onClick }) {
  const latencyMs  = trace.latencyMs ?? 0;
  const inputTok   = trace.inputTokens ?? 0;
  const outputTok  = trace.outputTokens ?? 0;
  const cost       = trace.cost ?? 0;
  const route      = trace.route || 'direct';

  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 14px',
        borderRadius: 'var(--radius-md)',
        background: isSelected ? 'rgba(139,92,246,0.06)' : 'rgba(255,255,255,0.01)',
        border: isSelected ? '1px solid rgba(139,92,246,0.5)' : '1px solid var(--border-color)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
      className="trace-item-card"
    >
      {/* top row: id + route + status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          {trace.id?.slice(0, 8)}…
        </span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <RouteBadge route={route} />
          <StatusBadge status={trace.status} />
        </div>
      </div>

      {/* model name */}
      <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {trace.model || '—'}
      </div>

      {/* provider + latency/tokens/cost */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>{trace.provider || '—'}</span>
        <span style={{ fontFamily: 'var(--font-mono)' }}>
          {fmtLatency(latencyMs)} · {fmtTokens(inputTok)}→{fmtTokens(outputTok)} · {fmtCost(cost)}
        </span>
      </div>
    </div>
  );
}

// ─── detail panel components ──────────────────────────────────────────────────

function KV({ label, value, mono = false, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0, marginRight: '12px' }}>{label}</span>
      <span style={{
        fontSize: '12px', fontWeight: 600,
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        color: accent || 'var(--text-main)',
        textAlign: 'right',
      }}>
        {value}
      </span>
    </div>
  );
}

// Section 2: Visual Route Graph
function RouteGraph({ route, model, provider, attempts, nodes, totalAttempts, attempt }) {
  const routeNodes = Array.isArray(nodes) && nodes.length > 0 ? nodes : [model];

  return (
    <div style={{
      background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)',
      borderRadius: '8px', padding: '16px', fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: '1.6',
    }}>
      <div style={{ fontWeight: 700, color: 'var(--color-primary)', marginBottom: '4px' }}>
        {model}
      </div>
      <div style={{ color: 'var(--text-subtle)', paddingLeft: '12px' }}>│</div>
      <div style={{ color: 'var(--text-subtle)', paddingLeft: '12px' }}>▼</div>
      <div style={{ fontWeight: 600, color: 'var(--text-main)', paddingLeft: '12px', margin: '2px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
        Strategy: <RouteBadge route={route} />
        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>({attempt}/{totalAttempts || routeNodes.length})</span>
      </div>
      <div style={{ color: 'var(--text-subtle)', paddingLeft: '12px' }}>│</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '12px' }}>
        {attempts && attempts.length > 0 ? (
          attempts.map((att, idx) => {
            const isSuccess = att.status === 'success' || att.status === 'winner';
            const isFail = att.status === 'failed';
            const isSkip = att.status === 'skipped';
            const isCancel = att.status === 'cancelled';
            const isLast = idx === attempts.length - 1;

            return (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--text-subtle)' }}>{isLast ? '└──' : '├──'}</span>
                <span style={{ fontWeight: 600, color: isSkip || isCancel ? 'var(--text-muted)' : 'var(--text-main)' }}>
                  {att.provider || att.connectionId} <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>({att.model})</span>
                </span>
                {att.durationMs ? (
                  <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-primary)', background: 'rgba(255,255,255,0.04)', padding: '1px 5px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                    +{att.durationMs}ms
                  </span>
                ) : null}
                <span className={`badge ${isSuccess ? 'badge-success' : isFail ? 'badge-danger' : 'badge-secondary'}`} style={{ fontSize: '9px', padding: '1px 6px' }}>
                  {isSuccess ? '✔ Success' : isFail ? `✖ Failed ${att.responseCode ? `(${att.responseCode})` : ''}` : isSkip ? 'skipped' : isCancel ? 'cancelled' : att.status}
                </span>
              </div>
            );
          })
        ) : (
          routeNodes.map((n, idx) => {
            const isWinner = idx === (attempt - 1);
            const isLast = idx === routeNodes.length - 1;
            return (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--text-subtle)' }}>{isLast ? '└──' : '├──'}</span>
                <span style={{ fontWeight: 600, color: isWinner ? 'var(--text-main)' : 'var(--text-muted)' }}>{n}</span>
                <span className={`badge ${isWinner ? 'badge-success' : 'badge-secondary'}`} style={{ fontSize: '9px', padding: '1px 6px' }}>
                  {isWinner ? '✔ Success' : 'skipped'}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// Section 3: Clean 6 Pipeline Steps
function PipelineTimeline({ pipeline }) {
  const defaultSteps = [
    { name: 'Resolve Model', status: 'success', details: 'Resolved model' },
    { name: 'Prompt Rewrite', status: 'skipped', details: 'skipped' },
    { name: 'Optimizer', status: 'skipped', details: 'skipped' },
    { name: 'Cache', status: 'skipped', details: 'bypass' },
    { name: 'Route', status: 'success', details: 'Executed routing strategy' },
    { name: 'Provider', status: 'success', details: 'Completed' },
  ];

  const steps = (pipeline && pipeline.length > 0) ? pipeline : defaultSteps;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {steps.map((step, idx) => {
        const isOk = step.status === 'success';
        const isFail = step.status === 'failed';
        const isSkip = step.status === 'skipped';

        return (
          <div key={idx} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 12px', background: 'var(--bg-sidebar)', borderRadius: '6px',
            border: '1px solid var(--border-color)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className={`material-symbols-outlined ${isOk ? 'text-success' : isFail ? 'text-danger' : 'text-subtle'}`} style={{ fontSize: '16px' }}>
                {isOk ? 'check_circle' : isFail ? 'cancel' : 'shortcut'}
              </span>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600 }}>{step.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{step.details}</div>
              </div>
            </div>
            {step.durationMs ? (
              <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-subtle)' }}>
                +{step.durationMs}ms
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function TraceDetailPanel({ trace, onClose }) {
  const {
    id, timestamp, status, provider, model, route, node, routeNodes,
    attempt, totalAttempts, latencyMs, ttfbMs, inputTokens, outputTokens, cachedTokens,
    compression, cache, cost, isStream, retryCount, fallbackCount,
    targetAttempts, pipeline, requestMeta, responseMeta, request, response,
  } = trace;

  const reqSys = requestMeta?.system || '';
  const reqUser = requestMeta?.user || '';
  const reqMsgs = requestMeta?.messages ?? (request ? 1 : 0);
  const reqChars = requestMeta?.chars ?? (request?.length || 0);
  const reqTokens = requestMeta?.tokens ?? inputTokens;

  const respPreview = responseMeta?.preview || response || '(No text output captured)';
  const finishReason = responseMeta?.finishReason || 'stop';

  return (
    <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '20px' }}>
        <div>
          <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(139,92,246,0.8)', fontWeight: 600 }}>
            Request Execution Details
          </span>
          <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
            {id}
          </div>
          <div style={{ marginTop: '6px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <StatusBadge status={status} />
            <RouteBadge route={route} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {timestamp ? new Date(timestamp).toLocaleTimeString() : ''}
            </span>
          </div>
        </div>
        <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', flexShrink: 0 }} onClick={onClose}>
          ✕ Close Detail
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* ── 1. SUMMARY ── */}
        <div>
          <h3 style={{ fontSize: '11px', fontWeight: 700, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-subtle)' }}>
            1. Summary
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
            <div style={{ background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '8px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Provider & Model</div>
              <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {provider} / {model}
              </div>
            </div>
            <div style={{ background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '8px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Latency & TTFB</div>
              <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '2px', fontFamily: 'var(--font-mono)', color: 'var(--color-primary)' }}>
                {fmtLatency(latencyMs)} <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400 }}>({fmtLatency(ttfbMs)} ttfb)</span>
              </div>
            </div>
            <div style={{ background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '8px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Tokens (In / Out / Cache)</div>
              <div style={{ fontSize: '12px', fontWeight: 700, marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                {fmtTokens(inputTokens)} → {fmtTokens(outputTokens)} <span style={{ fontSize: '10px', color: 'var(--color-accent)' }}>({fmtTokens(cachedTokens)} cached)</span>
              </div>
            </div>
            <div style={{ background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '8px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Cost</div>
              <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '2px', fontFamily: 'var(--font-mono)', color: cost === 0 ? 'var(--color-success)' : 'var(--text-main)' }}>
                {fmtCost(cost)}
              </div>
            </div>
          </div>

          {/* Metrics bar */}
          <div style={{ background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '4px 14px', marginTop: '10px' }}>
            <KV label="Prompt Compression" value={compression > 0 ? `${compression}%` : 'None'} mono accent={compression > 0 ? 'var(--color-accent)' : undefined} />
            <KV label="Cache Hit" value={cache === 'hit' ? 'Yes' : 'No'} mono accent={cache === 'hit' ? 'var(--color-success)' : undefined} />
            <KV label="Streaming" value={isStream ? 'Yes' : 'No'} mono />
            <KV label="Attempts" value={`${attempt}/${totalAttempts || (routeNodes?.length || 1)}`} mono />
            <KV label="Fallback Count" value={fallbackCount} mono />
            <KV label="Retry Count" value={retryCount} mono />
          </div>
        </div>

        {/* ── 2. ROUTE GRAPH ── */}
        <div>
          <h3 style={{ fontSize: '11px', fontWeight: 700, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-subtle)' }}>
            2. Route Graph
          </h3>
          <RouteGraph
            route={route}
            model={model}
            provider={provider}
            attempts={targetAttempts}
            nodes={routeNodes}
            totalAttempts={totalAttempts}
            attempt={attempt}
          />
        </div>

        {/* ── 3. PIPELINE ── */}
        <div>
          <h3 style={{ fontSize: '11px', fontWeight: 700, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-subtle)' }}>
            3. Pipeline (Routing Steps)
          </h3>
          <PipelineTimeline pipeline={pipeline} />
        </div>

        {/* ── 4. REQUEST / RESPONSE PREVIEW ── */}
        <div>
          <h3 style={{ fontSize: '11px', fontWeight: 700, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-subtle)' }}>
            4. Request / Response Preview
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>

            {/* Request Card */}
            <div style={{ background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-primary)' }}>Request Payload</span>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  {reqMsgs} msgs · {reqChars.toLocaleString()} chars · {reqTokens.toLocaleString()} tokens
                </span>
              </div>
              {reqSys && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>System Prompt</div>
                  <pre style={{ fontSize: '11px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '8px 10px', borderRadius: '4px', marginTop: '4px', whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto', margin: 0 }}>
                    {reqSys}
                  </pre>
                </div>
              )}
              {reqUser && (
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>User Input</div>
                  <pre style={{ fontSize: '11px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '8px 10px', borderRadius: '4px', marginTop: '4px', whiteSpace: 'pre-wrap', maxHeight: '120px', overflowY: 'auto', margin: 0 }}>
                    {reqUser}
                  </pre>
                </div>
              )}
              {!reqSys && !reqUser && request && (
                <pre style={{ fontSize: '11px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '8px 10px', borderRadius: '4px', marginTop: '4px', whiteSpace: 'pre-wrap', maxHeight: '180px', overflowY: 'auto', margin: 0 }}>
                  {request}
                </pre>
              )}
            </div>

            {/* Response Card */}
            <div style={{ background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-success)' }}>Response Output</span>
                <span className="badge badge-secondary" style={{ fontSize: '10px' }}>
                  finish: {finishReason}
                </span>
              </div>
              <pre style={{ fontSize: '11px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '8px 10px', borderRadius: '4px', marginTop: '4px', whiteSpace: 'pre-wrap', maxHeight: '220px', overflowY: 'auto', margin: 0 }}>
                {respPreview}
              </pre>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function TracesPage() {
  const notify = useSnackbar((s) => s.notify);
  const [traces, setTraces] = useState([]);
  const [selectedTrace, setSelectedTrace] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const perPage = 20;

  const fetchTraces = async (p = page) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/traces?page=${p}&perPage=${perPage}`);
      if (res.ok) {
        const data = await res.json();
        setTraces(data.traces || []);
        setTotal(data.total || 0);
      }
    } catch (err) {
      console.error('Error fetching traces:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchTraces(1); }, []);

  const handlePageChange = (newPage) => {
    setPage(newPage);
    fetchTraces(newPage);
  };

  const handleResetTraces = async () => {
    if (!confirm('Are you sure you want to reset and clear all tracer data?')) return;
    try {
      const res = await fetch('/api/traces', { method: 'DELETE' });
      if (res.ok) {
        notify('All tracer data reset successfully.', 'info');
        setSelectedTrace(null);
        await fetchTraces(1);
      } else {
        notify('Failed to reset tracer data.', 'error');
      }
    } catch {
      notify('Error resetting tracer data.', 'error');
    }
  };

  const selectTrace = async (id) => {
    try {
      const res = await fetch(`/api/traces/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedTrace(data);
      }
    } catch (err) {
      console.error('Error fetching trace detail:', err);
    }
  };

  const filteredTraces = traces.filter(t =>
    t.model?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.provider?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.id && t.id.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      {/* Page header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined text-primary" style={{ fontSize: '28px' }}>monitoring</span>
            Request Traces
          </h1>
          <p className="page-description">Routing analytics: Summary · Route Graph · Pipeline · Request / Response Preview</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={() => fetchTraces(page)}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>refresh</span>
            Refresh
          </button>
          <button className="btn btn-secondary" onClick={handleResetTraces} style={{ color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.3)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete_sweep</span>
            Reset
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedTrace ? '320px 1fr' : '1fr', gap: '20px', transition: 'all 0.3s ease' }}>

        {/* Left: Traces list */}
        <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', overflowY: 'hidden' }}>
          <div style={{ marginBottom: '12px' }}>
            <input
              type="text"
              placeholder="Search by model, provider, ID…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field"
              style={{ fontSize: '12px', padding: '8px 12px' }}
            />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {isLoading && traces.length === 0 ? (
              <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                Loading traces…
              </div>
            ) : filteredTraces.length === 0 ? (
              <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                No traces found
              </div>
            ) : (
              filteredTraces.map((t) => (
                <TraceListCard
                  key={t.id}
                  trace={t}
                  isSelected={selectedTrace?.id === t.id}
                  onClick={() => selectTrace(t.id)}
                />
              ))
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '11px', opacity: page <= 1 ? 0.4 : 1 }}
              >‹</button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let p;
                if (totalPages <= 5) p = i + 1;
                else if (page <= 3) p = i + 1;
                else if (page >= totalPages - 2) p = totalPages - 4 + i;
                else p = page - 2 + i;
                return (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p)}
                    style={{
                      padding: '4px 10px', fontSize: '11px',
                      fontWeight: page === p ? 700 : 400,
                      border: 'none', borderRadius: '4px', cursor: 'pointer',
                      background: page === p ? 'var(--color-primary)' : 'transparent',
                      color: page === p ? '#fff' : 'var(--text-muted)',
                    }}
                  >{p}</button>
                );
              })}
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: '11px', opacity: page >= totalPages ? 0.4 : 1 }}
              >›</button>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '6px' }}>{total} total</span>
            </div>
          )}
        </div>

        {/* Right: Detail panel */}
        {selectedTrace && (
          <TraceDetailPanel
            trace={selectedTrace}
            onClose={() => setSelectedTrace(null)}
          />
        )}
      </div>
    </div>
  );
}