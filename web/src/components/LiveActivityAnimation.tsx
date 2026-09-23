import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, Boxes, Layers, Zap } from 'lucide-react'
import type { LiveSession, LiveSnapshot } from '@/lib/useLiveActivity'
import { cn } from '@/lib/cn'

/*
 * Minimalist live-activity animation for the Overview page.
 *
 * Design contract (matches the dashboard's no-slop system): one accent color,
 * 1px borders, flat surfaces, no gradients, no glow, no blur. Motion is
 * limited to a 1px-tall bar sweeping left→right plus a soft ping on the
 * status dot — enough to read "work is happening" from across the room
 * without becoming a light show.
 *
 * It is driven entirely by numbers the gateway already tracks (rps, tps,
 * active, streams, per-session step/tokens), so it never invents motion when
 * nothing is happening: with zero active sessions it renders as a quiet row.
 */

/** Blinking cursor used while a stream is emitting. */
function LiveCursor({ tone = 'accent' }: { tone?: 'accent' | 'warning' }) {
  return (
    <span
      className={cn(
        'inline-block h-3 w-[2px] translate-y-[1px] rounded-full align-middle',
        tone === 'accent' ? 'bg-accent' : 'bg-warning',
      )}
      style={{ animation: 'live-cursor 1s steps(2, start) infinite' }}
    />
  )
}

/** Sweeping 1px progress line — the "something is running" signal. */
function RunningSweep({ tone }: { tone: 'accent' | 'warning' | 'success' | 'danger' }) {
  const bg =
    tone === 'accent' ? 'bg-accent' : tone === 'warning' ? 'bg-warning' : tone === 'success' ? 'bg-success' : 'bg-danger'
  return (
    <div className="relative h-px w-full overflow-hidden bg-border/70">
      <div
        className={cn('absolute inset-y-0 w-1/3', bg)}
        style={{ animation: 'live-sweep 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}
      />
    </div>
  )
}

/** Four 2px bars pulsing in sequence, level-meter style. Idle = flat. */
function ActivityMeter({ level }: { level: number }) {
  // level 0..1 — clamped, and quantized so the bars read as discrete steps
  // rather than a jittery continuum.
  const bars = 4
  const lit = Math.max(0, Math.min(bars, Math.round(level * bars)))
  return (
    <span className="inline-flex items-end gap-[2px]" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={cn('w-[2px] rounded-sm transition-[height,background-color] duration-300', i < lit ? 'bg-accent' : 'bg-border-strong')}
          style={{
            height: `${4 + i * 3}px`,
            animation: i < lit ? `live-bar 900ms ease-in-out ${i * 110}ms infinite alternate` : undefined,
          }}
        />
      ))}
    </span>
  )
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

const STEP_LABELS: Record<string, string> = {
  Received: 'reading request',
  Routed: 'resolving route',
  Upstream: 'waiting on upstream',
  Streaming: 'streaming tokens',
  Done: 'finishing',
}

function statusTone(status: LiveSession['status']): 'accent' | 'warning' | 'success' | 'danger' {
  switch (status) {
    case 'running':
      return 'accent'
    case 'waiting':
      return 'warning'
    case 'ok':
      return 'success'
    default:
      return 'danger'
  }
}

const TONE_TEXT = {
  accent: 'text-accent',
  warning: 'text-warning',
  success: 'text-success',
  danger: 'text-danger',
} as const

const TONE_DOT = {
  accent: 'bg-accent',
  warning: 'bg-warning',
  success: 'bg-success',
  danger: 'bg-danger',
} as const

const TONE_PING = {
  accent: 'bg-accent/40',
  warning: 'bg-warning/40',
  success: 'bg-success/40',
  danger: 'bg-danger/40',
} as const

/**
 * One session row. Elapsed time keeps counting locally between polls so the
 * timer never appears to freeze on a slow gateway.
 */
function SessionRow({ session, nowMs }: { session: LiveSession; nowMs: number }) {
  const tone = statusTone(session.status)
  const live = session.status === 'running' || session.status === 'waiting'

  // Elapsed is anchored once per session from the first snapshot that carried
  // it, then advanced by the local 100ms clock. Using the server's own
  // elapsedMs on every render would make the timer jump backwards between
  // polls (server clocks and poll latency both drift).
  const anchor = useRef<number>(nowMs - session.elapsedMs)
  useEffect(() => {
    anchor.current = nowMs - session.elapsedMs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])
  const elapsed = session.finished ? session.elapsedMs : Math.max(session.elapsedMs, nowMs - anchor.current)

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
        <span className={cn('h-1.5 w-1.5 rounded-full', TONE_DOT[tone])} />
        {live && (
          <span
            className={cn('absolute inset-0 h-1.5 w-1.5 rounded-full', TONE_PING[tone])}
            style={{ animation: 'live-ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite' }}
          />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <code className="truncate font-mono text-[11px] font-medium text-text">{session.model || 'unknown'}</code>
          {session.combo && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1 py-px text-[9px] text-muted">
              <Layers size={9} />
              {session.combo}
            </span>
          )}
          {session.targets > 1 && (
            <span className="tnum inline-flex shrink-0 items-center gap-1 rounded border border-border px-1 py-px text-[9px] text-subtle">
              <Boxes size={9} />
              {session.inflight > 1 ? `${session.inflight}/${session.targets}` : `${session.targets} targets`}
            </span>
          )}
          {session.attempt > 1 && (
            <span className="tnum inline-flex shrink-0 items-center gap-1 rounded border border-border px-1 py-px text-[9px] text-subtle">
              <ArrowDownUp size={9} />
              try {session.attempt}
            </span>
          )}
          {session.stream && live && <LiveCursor tone={tone === 'warning' ? 'warning' : 'accent'} />}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-subtle">
          <span className={cn(TONE_TEXT[tone])}>{STEP_LABELS[session.step] ?? session.step.toLowerCase()}</span>
          {session.provider && <span className="truncate">{session.provider}</span>}
        </div>
      </div>

      <div className="tnum shrink-0 text-right text-[10px] leading-tight text-muted">
        <div className={cn(live ? TONE_TEXT[tone] : 'text-muted')}>{fmtMs(elapsed)}</div>
        {session.ttfbMs > 0 && <div className="text-subtle">ttfb {fmtMs(session.ttfbMs)}</div>}
      </div>

      <div className="tnum w-16 shrink-0 text-right text-[10px] leading-tight">
        {live ? (
          <>
            <div className="text-text">{fmtTokens(session.outTokens ? Math.ceil(session.outTokens / 4) : 0)} tok</div>
            <div className="text-subtle">live</div>
          </>
        ) : (
          <>
            <div className="text-text">{fmtTokens(session.promptTokens + session.completionTokens)} tok</div>
            <div className={session.status === 'ok' ? 'text-success' : 'text-danger'}>
              {session.status === 'ok' ? 'done' : session.responseCode ? `HTTP ${session.responseCode}` : 'failed'}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function LiveActivityAnimation({ snapshot, stale }: { snapshot: LiveSnapshot; stale: boolean }) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [recentlyDone, setRecentlyDone] = useState<LiveSession[]>([])
  const seenDone = useRef<Map<string, { at: number; session: LiveSession }>>(new Map())

  // Local 100ms clock: elapsed timers and the meter must keep moving between
  // polls (1.2s) or the animation looks broken.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 100)
    return () => clearInterval(id)
  }, [])

  // Finished sessions linger ~5s after they leave the snapshot: with the
  // since-filter the server stops resending them almost immediately, so
  // without this the "done" row would blink away in under a second.
  useEffect(() => {
    const now = Date.now()
    for (const s of snapshot.sessions) {
      if (s.finished) seenDone.current.set(s.id, { at: now, session: s })
      else seenDone.current.set(s.id, { at: seenDone.current.get(s.id)?.at ?? now, session: s })
    }
    for (const [id, rec] of seenDone.current) {
      if (now - rec.at > 5000) seenDone.current.delete(id)
    }
    const done = Array.from(seenDone.current.values())
      .map((r) => r.session)
      .filter((s) => s.finished)
      .sort((a, b) => (seenDone.current.get(b.id)?.at ?? 0) - (seenDone.current.get(a.id)?.at ?? 0))
    setRecentlyDone(done.slice(0, 3))
  }, [snapshot])

  const { running, waiting, done } = useMemo(() => {
    const r: LiveSession[] = []
    const w: LiveSession[] = []
    const d: LiveSession[] = []
    for (const s of snapshot.sessions) {
      if (s.status === 'running') r.push(s)
      else if (s.status === 'waiting') w.push(s)
      else d.push(s)
    }
    const rank = (s: LiveSession) => (s.stream ? 0 : s.inflight > 0 ? 1 : 2)
    r.sort((a, b) => rank(a) - rank(b) || b.elapsedMs - a.elapsedMs)
    w.sort((a, b) => b.elapsedMs - a.elapsedMs)
    d.sort((a, b) => b.elapsedMs - a.elapsedMs)
    return { running: r, waiting: w, done: d }
  }, [snapshot])

  const active = running.length + waiting.length
  const isWorking = active > 0
  const hasError = done.some((s) => s.status === 'error')

  // Meter level: recent throughput normalized against a soft ceiling, so a
  // busy gateway lights all four bars and an idle one goes flat.
  const level = useMemo(() => {
    const byRps = snapshot.rps / 4
    const byInflight = snapshot.inflight / 3
    return Math.max(byRps, byInflight)
  }, [snapshot.rps, snapshot.inflight])

  const tone: 'accent' | 'warning' | 'danger' | 'success' = stale
    ? 'danger'
    : running.length > 0
      ? 'accent'
      : waiting.length > 0
        ? 'warning'
        : hasError
          ? 'danger'
          : 'success'

  const statusLabel = stale
    ? 'Disconnected'
    : running.length > 0
      ? 'Running'
      : waiting.length > 0
        ? 'Waiting'
        : active === 0 && done.length > 0
          ? 'Idle'
          : 'Idle'

  const headline = stale
    ? 'Gateway feed unavailable — retrying'
    : active > 0
      ? `${active} request${active === 1 ? '' : 's'} in flight${snapshot.streams > 0 ? ` · ${snapshot.streams} streaming` : ''}`
      : recentlyDone.length > 0
        ? `Last request finished ${recentlyDone[0]?.status === 'ok' ? 'successfully' : 'with an error'}`
        : 'No active requests'

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative inline-flex h-2 w-2 shrink-0">
            <span className={cn('h-2 w-2 rounded-full', TONE_DOT[tone])} />
            {isWorking && !stale && (
              <span
                className={cn('absolute inset-0 h-2 w-2 rounded-full', TONE_PING[tone])}
                style={{ animation: 'live-ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite' }}
              />
            )}
          </span>
          <span className="text-[13px] font-semibold">Live Activity</span>
          <span
            className={cn(
              'rounded border px-1.5 py-px text-[10px] font-medium',
              tone === 'accent' && 'border-accent/30 bg-accent-subtle text-accent',
              tone === 'warning' && 'border-warning/30 bg-warning-subtle text-warning',
              tone === 'success' && 'border-success/30 bg-success-subtle text-success',
              tone === 'danger' && 'border-danger/30 bg-danger-subtle text-danger',
            )}
          >
            {statusLabel}
          </span>
          <ActivityMeter level={level} />
        </div>

        <div className="tnum flex items-center gap-3 text-[10px] text-subtle">
          <span className="inline-flex items-center gap-1" title="Rolling requests per second (10s window)">
            <Zap size={10} className="text-subtle" />
            {snapshot.rps.toFixed(1)} rps
          </span>
          <span title="Upstream attempts in flight">{snapshot.inflight} inflight</span>
          {snapshot.retries > 0 && <span className="text-warning">{snapshot.retries} retries</span>}
          {snapshot.errors > 0 && <span className="text-danger">{snapshot.errors} errors</span>}
        </div>
      </div>

      {/* The sweep: only animates while work is in flight. */}
      {isWorking && !stale ? <RunningSweep tone={tone} /> : <div className="h-px w-full bg-border/70" />}

      {/* Rows */}
      {active > 0 || recentlyDone.length > 0 ? (
        <div className="divide-y divide-border/60">
          {[...running, ...waiting].slice(0, 6).map((s) => (
            <SessionRow key={s.id} session={s} nowMs={nowMs} />
          ))}
          {active === 0 &&
            recentlyDone.map((s) => (
              <div key={s.id} className="opacity-60">
                <SessionRow session={s} nowMs={nowMs} />
              </div>
            ))}
        </div>
      ) : (
        <div className="px-4 py-3 text-[11px] text-subtle">{headline}</div>
      )}

      {active > 6 && (
        <div className="border-t border-border/60 px-4 py-1.5 text-[10px] text-subtle">
          +{active - 6} more in flight
        </div>
      )}
    </div>
  )
}
