import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, ArrowRight, Cpu, Layers, Radio, Route as RouteIcon, Zap } from 'lucide-react'
import type { LiveSnapshot } from '@/lib/useLiveActivity'
import type { Combo, ProviderConnection } from '@/lib/types'
import { Badge } from '@/components/ui'
import ProviderIcon from '@/components/ProviderIcon'
import { cn } from '@/lib/cn'

interface RouteTopologyCardProps {
  connections: ProviderConnection[]
  combos: Combo[]
  live: LiveSnapshot | null
  gatewayUp: boolean
}

const KIND_LABELS: Record<string, string> = {
  fallback: 'Backup Chain',
  load_balance: 'Share Load',
  smart: 'Smart Pick',
}

function shortId(id: string): string {
  return id.replace(/^(openai|anthropic)-compatible-/, '')
}

/** Animated SVG flow bridge between topology columns on desktop. */
function FlowConnector({ active, healthy }: { active: boolean; healthy: boolean }) {
  const strokeColor = active ? 'var(--accent)' : healthy ? 'var(--success)' : 'var(--border-strong)'
  const dur = active ? '0.9s' : '3.2s'
  const paths = [
    'M 0 60 C 24 60, 24 22, 48 22',
    'M 0 60 C 24 60, 24 60, 48 60',
    'M 0 60 C 24 60, 24 98, 48 98',
  ]

  return (
    <div className="hidden items-center justify-center lg:flex" aria-hidden="true">
      <svg viewBox="0 0 48 120" className="h-32 w-12 overflow-visible">
        {paths.map((d, i) => (
          <g key={i}>
            <path d={d} fill="none" stroke="var(--border)" strokeWidth="1.5" />
            <path
              d={d}
              fill="none"
              stroke={strokeColor}
              strokeWidth={active ? '2' : '1.5'}
              strokeDasharray="5 7"
              strokeOpacity={active ? 0.95 : 0.45}
              style={{ animation: `flow-dash ${dur} linear infinite` }}
            />
            {active && (
              <circle r="2.8" fill="var(--accent)">
                <animateMotion dur={`${0.9 + i * 0.2}s`} repeatCount="indefinite" path={d} />
              </circle>
            )}
          </g>
        ))}
      </svg>
    </div>
  )
}

export default function RouteTopologyCard({ connections, combos, live, gatewayUp }: RouteTopologyCardProps) {
  const navigate = useNavigate()
  const activeSessions = useMemo(
    () => (live?.sessions ?? []).filter((s) => s.status === 'running' || s.status === 'waiting'),
    [live],
  )
  const isStreaming = activeSessions.length > 0

  const activeProviders = useMemo(() => {
    const map = new Map<string, ProviderConnection>()
    for (const c of connections) {
      const existing = map.get(c.provider)
      if (!existing || (!existing.isActive && c.isActive)) {
        map.set(c.provider, c)
      }
    }
    return Array.from(map.values())
  }, [connections])

  const activeComboNames = useMemo(
    () => new Set(activeSessions.map((s) => s.combo).filter(Boolean)),
    [activeSessions],
  )
  const activeProviderNames = useMemo(
    () => new Set(activeSessions.map((s) => s.provider).filter(Boolean)),
    [activeSessions],
  )

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface p-5">
      {/* Subtle futuristic dot/grid background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.045]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '20px 20px',
        }}
      />

      {/* Ambient accent radial highlight behind ingress when active/healthy */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full blur-3xl transition-opacity duration-500"
        style={{
          background: isStreaming ? 'var(--accent)' : 'var(--success)',
          opacity: isStreaming ? 0.14 : 0.05,
        }}
      />

      {/* Top status bar */}
      <div className="relative mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'relative flex h-9 w-9 items-center justify-center rounded-lg border',
              isStreaming
                ? 'border-accent bg-accent-subtle text-accent'
                : gatewayUp
                  ? 'border-border bg-surface-2 text-success'
                  : 'border-danger bg-danger-subtle text-danger',
            )}
          >
            <Radio size={17} className={isStreaming ? 'animate-pulse' : ''} />
            {gatewayUp && (
              <span
                className={cn('absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-surface', isStreaming ? 'bg-accent' : 'bg-success')}
                style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}
              />
            )}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text">Live Routing Topology</h3>
              <Badge tone={isStreaming ? 'accent' : gatewayUp ? 'success' : 'danger'}>
                {isStreaming ? `${activeSessions.length} active stream${activeSessions.length > 1 ? 's' : ''}` : gatewayUp ? 'Standby' : 'Offline'}
              </Badge>
            </div>
            <p className="text-xs text-muted">
              Real-time signal flow from Gateway through your Routes and connected Providers.
            </p>
          </div>
        </div>

        <div className="tnum flex items-center gap-4 rounded-lg border border-border bg-bg/80 px-3.5 py-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Activity size={13} className="text-accent" />
            <strong className="text-text">{(live?.rps ?? 0).toFixed(1)}</strong> req/s
          </span>
          <span className="h-3 w-px bg-border" />
          <span className="inline-flex items-center gap-1.5">
            <Zap size={13} className="text-accent" />
            <strong className="text-text">{Math.round(live?.tps ?? 0)}</strong> tok/s
          </span>
        </div>
      </div>

      {/* 3-column interactive topology with animated SVG connectors */}
      <div className="relative grid items-stretch gap-4 lg:grid-cols-[220px_48px_1fr_48px_1fr] lg:gap-0">
        {/* Column 1: Gateway Hub */}
        <div className="flex flex-col justify-between rounded-xl border border-border bg-bg/90 p-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Ingress</span>
              <span className="relative flex h-2.5 w-2.5">
                <span className={cn('h-2.5 w-2.5 rounded-full', gatewayUp ? 'bg-success' : 'bg-danger')} />
                {gatewayUp && (
                  <span
                    className={cn('absolute inset-0 rounded-full', isStreaming ? 'bg-accent' : 'bg-success')}
                    style={{ animation: 'live-ping 2.2s cubic-bezier(0, 0, 0.2, 1) infinite' }}
                  />
                )}
              </span>
            </div>
            <div className="mt-3.5 flex items-center gap-3">
              <div
                className={cn(
                  'relative flex h-11 w-11 items-center justify-center rounded-xl border transition-colors',
                  isStreaming ? 'border-accent bg-accent-subtle text-accent' : 'border-accent/40 bg-accent-subtle/60 text-accent',
                )}
              >
                <Cpu size={20} />
              </div>
              <div>
                <div className="text-sm font-semibold text-text">MyAiRouter</div>
                <div className="font-mono text-[11px] text-muted">/v1/chat</div>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs text-muted">
            <div className="flex justify-between">
              <span>Routes</span>
              <strong className="tnum text-text">{combos.length}</strong>
            </div>
            <div className="flex justify-between">
              <span>Active Providers</span>
              <strong className="tnum text-text">{activeProviders.filter((p) => p.isActive).length}</strong>
            </div>
          </div>
        </div>

        <FlowConnector active={isStreaming} healthy={gatewayUp} />

        {/* Column 2: Connected Routes */}
        <div className="flex flex-col rounded-xl border border-border bg-bg/90 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
              <RouteIcon size={12} /> Routes ({combos.length})
            </span>
            <button
              type="button"
              onClick={() => navigate('/combos')}
              className="text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Manage
            </button>
          </div>

          {combos.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-6 text-center text-xs text-subtle">
              <span>No routes configured yet.</span>
              <button type="button" onClick={() => navigate('/combos')} className="mt-1.5 text-accent hover:underline">
                Create a route →
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {combos.slice(0, 4).map((c) => {
                const hot = activeComboNames.has(c.name)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => navigate('/combos')}
                    className={cn(
                      'group relative flex items-center justify-between gap-2 overflow-hidden rounded-lg border px-3.5 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      hot
                        ? 'border-accent bg-accent-subtle/60'
                        : 'border-border bg-surface hover:border-border-strong',
                    )}
                  >
                    {hot && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 top-0 h-[2px] bg-accent"
                        style={{ animation: 'live-sweep 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', hot ? 'bg-accent animate-pulse' : 'bg-success')} />
                        <span className="truncate font-mono text-xs font-semibold text-text">{c.name}</span>
                        <Badge tone={hot ? 'accent' : 'neutral'}>{KIND_LABELS[c.kind] ?? c.kind}</Badge>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-muted">
                        <Layers size={11} className="shrink-0 text-subtle" />
                        <span className="truncate">{(c.models ?? []).join(' → ')}</span>
                      </div>
                    </div>
                    <ArrowRight size={14} className="shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-text" />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <FlowConnector active={isStreaming} healthy={gatewayUp && activeProviders.some((p) => p.isActive)} />

        {/* Column 3: Connected Providers */}
        <div className="flex flex-col rounded-xl border border-border bg-bg/90 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
              Providers ({activeProviders.length})
            </span>
            <button
              type="button"
              onClick={() => navigate('/providers')}
              className="text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Manage
            </button>
          </div>

          {activeProviders.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-6 text-center text-xs text-subtle">
              <span>No providers connected yet.</span>
              <button type="button" onClick={() => navigate('/providers')} className="mt-1.5 text-accent hover:underline">
                Connect a provider →
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {activeProviders.slice(0, 6).map((conn) => {
                const label = shortId(conn.provider)
                const hot = activeProviderNames.has(conn.provider)
                return (
                  <button
                    key={conn.id}
                    type="button"
                    onClick={() => navigate('/providers')}
                    className={cn(
                      'relative flex items-center gap-2.5 overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      hot
                        ? 'border-accent bg-accent-subtle/60'
                        : conn.isActive
                          ? 'border-border bg-surface hover:border-border-strong'
                          : 'border-border bg-surface/60 opacity-60',
                    )}
                  >
                    {hot && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-0 bottom-0 h-[2px] bg-accent"
                        style={{ animation: 'live-sweep 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}
                      />
                    )}
                    <ProviderIcon id={conn.provider} name={label} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold capitalize text-text">{label}</div>
                      <div className="text-[11px] text-muted">
                        {hot ? 'Streaming…' : conn.isActive ? 'Ready' : 'Paused'}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        hot ? 'bg-accent animate-ping' : conn.isActive ? 'bg-success' : 'bg-subtle',
                      )}
                    />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
