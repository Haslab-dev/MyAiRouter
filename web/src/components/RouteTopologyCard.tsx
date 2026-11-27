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

function shortId(id: string): string {
  return id.replace(/^(openai|anthropic)-compatible-/, '')
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
      {/* Subtle futuristic grid background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Top status bar */}
      <div className="relative mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'relative flex h-8 w-8 items-center justify-center rounded-lg border',
              isStreaming
                ? 'border-accent bg-accent-subtle text-accent'
                : gatewayUp
                  ? 'border-border bg-surface-2 text-success'
                  : 'border-danger bg-danger-subtle text-danger',
            )}
          >
            <Radio size={16} className={isStreaming ? 'animate-pulse' : ''} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text">Live Routing Topology</h3>
              <Badge tone={isStreaming ? 'accent' : gatewayUp ? 'success' : 'danger'}>
                {isStreaming ? `${activeSessions.length} active stream${activeSessions.length > 1 ? 's' : ''}` : gatewayUp ? 'Standby' : 'Offline'}
              </Badge>
            </div>
            <p className="text-xs text-muted">
              Real-time flow from Gateway through your Routes and connected Providers.
            </p>
          </div>
        </div>

        <div className="tnum flex items-center gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Activity size={13} className="text-accent" />
            <strong className="text-text">{(live?.rps ?? 0).toFixed(1)}</strong> req/s
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Zap size={13} className="text-accent" />
            <strong className="text-text">{Math.round(live?.tps ?? 0)}</strong> tok/s
          </span>
        </div>
      </div>

      {/* 3-column interactive topology: Gateway -> Routes -> Providers */}
      <div className="relative grid items-stretch gap-4 lg:grid-cols-[200px_1fr_1fr]">
        {/* Column 1: Gateway Hub */}
        <div className="flex flex-col justify-between rounded-xl border border-border bg-bg p-4">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">Ingress</span>
              <span className={cn('h-2 w-2 rounded-full', gatewayUp ? 'bg-success' : 'bg-danger', isStreaming && 'animate-ping')} />
            </div>
            <div className="mt-3 flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/40 bg-accent-subtle text-accent">
                <Cpu size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-text">MyAiRouter</div>
                <div className="font-mono text-[11px] text-muted">/v1/chat</div>
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-border pt-3 text-xs text-muted">
            <div className="flex justify-between">
              <span>Routes</span>
              <strong className="tnum text-text">{combos.length}</strong>
            </div>
            <div className="mt-1 flex justify-between">
              <span>Active Providers</span>
              <strong className="tnum text-text">{activeProviders.filter((p) => p.isActive).length}</strong>
            </div>
          </div>
        </div>

        {/* Column 2: Connected Routes */}
        <div className="flex flex-col rounded-xl border border-border bg-bg p-4">
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
            <div className="flex flex-col gap-2">
              {combos.slice(0, 4).map((c) => {
                const hot = activeComboNames.has(c.name)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => navigate('/combos')}
                    className={cn(
                      'group relative flex items-center justify-between gap-2 overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
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
                        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', hot ? 'bg-accent animate-pulse' : 'bg-success')} />
                        <span className="truncate font-mono text-xs font-semibold text-text">{c.name}</span>
                        <Badge tone={hot ? 'accent' : 'neutral'}>{c.kind}</Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-1 truncate font-mono text-[11px] text-muted">
                        <Layers size={10} className="shrink-0 text-subtle" />
                        <span className="truncate">{(c.models ?? []).join(' → ')}</span>
                      </div>
                    </div>
                    <ArrowRight size={13} className="shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-text" />
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Column 3: Connected Providers */}
        <div className="flex flex-col rounded-xl border border-border bg-bg p-4">
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
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {activeProviders.slice(0, 6).map((conn) => {
                const label = shortId(conn.provider)
                const hot = activeProviderNames.has(conn.provider)
                return (
                  <button
                    key={conn.id}
                    type="button"
                    onClick={() => navigate('/providers')}
                    className={cn(
                      'relative flex items-center gap-2.5 overflow-hidden rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
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
                    <ProviderIcon id={conn.provider} name={label} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold capitalize text-text">{label}</div>
                      <div className="text-[10px] text-muted">
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
