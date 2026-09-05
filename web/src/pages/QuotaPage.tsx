import { useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { useSnackbar } from '@/stores/snackbar'
import { Badge, Button, Card, PageContainer, PageHeader, Spinner, Toggle, EmptyState } from '@/components/ui'
import type { ConnectionHealth, ProviderConnection } from '@/lib/types'

export default function QuotaPage() {
  const notify = useSnackbar((s) => s.notify)
  const [connections, setConnections] = useState<ProviderConnection[]>([])
  const [health, setHealth] = useState<Record<string, ConnectionHealth>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchAll = async () => {
    try {
      const [conns, healthList] = await Promise.all([
        api.get<ProviderConnection[]>('/api/providers'),
        api.get<ConnectionHealth[]>('/api/connections/health').catch(() => []),
      ])
      setConnections(conns ?? [])
      const map: Record<string, ConnectionHealth> = {}
      for (const h of healthList ?? []) map[h.connectionId] = h
      setHealth(map)
      setError('')
    } catch {
      setError('Failed to fetch provider connections')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAll()
  }, [])

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      await api.patch(`/api/providers/${id}`, { isActive: !currentActive })
      await fetchAll()
      notify(`Provider ${currentActive ? 'disabled' : 'enabled'}`, 'success')
    } catch {
      notify('Failed to update provider status', 'error')
    }
  }

  const handleDeleteConnection = async (id: string) => {
    if (!confirm('Disconnect this provider?')) return
    try {
      await api.del(`/api/providers/${id}`)
      await fetchAll()
      notify('Provider connection removed', 'info')
    } catch {
      notify('Failed to remove provider', 'error')
    }
  }

  const healthTone = (conn: ProviderConnection): 'success' | 'warning' | 'danger' | 'neutral' => {
    if (!conn.isActive) return 'neutral'
    const h = health[conn.id]
    if (!h) return 'success'
    if (!h.healthy) return 'danger'
    if (h.consecutiveFailures > 0) return 'warning'
    return 'success'
  }

  return (
    <PageContainer>
      <PageHeader
        title="Health"
        description="Upstream connection state: routing cooldowns, observed latency, and rate-limit headroom."
        actions={
          <Button size="sm" onClick={fetchAll}>
            <RefreshCw size={13} /> Refresh
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : error ? (
        <div className="py-16 text-center text-[13px] text-danger">{error}</div>
      ) : connections.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck size={28} />}
            title="No connected nodes"
            hint="Register provider access keys in the Providers page to see connection health here."
          />
        </Card>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(380px,1fr))]">
          {connections.map((conn) => {
            const h = health[conn.id]
            const tone = healthTone(conn)
            return (
              <Card key={conn.id}>
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-sm font-semibold text-muted">
                      {conn.provider.charAt(0).toUpperCase()}
                    </span>
                    <div>
                      <div className="text-sm font-semibold capitalize">{conn.provider}</div>
                      <div className="text-xs text-muted">{conn.name || conn.email || 'Unnamed key'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => handleDeleteConnection(conn.id)} className="text-danger hover:bg-danger-subtle hover:text-danger">
                      Remove
                    </Button>
                    <Toggle checked={conn.isActive} onChange={() => handleToggleActive(conn.id, conn.isActive)} label="Toggle connection" />
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border pt-3">
                  <div className="flex items-center gap-1.5">
                    <Badge tone={tone}>
                      {!conn.isActive ? 'Inactive' : tone === 'danger' ? 'Cooling down' : tone === 'warning' ? 'Degraded' : 'Healthy'}
                    </Badge>
                    {h && !h.healthy && (
                      <span className="tnum text-[11px] text-subtle">retry in {h.cooldownSecondsLeft}s</span>
                    )}
                  </div>
                  <span className="tnum text-[11px] text-subtle">Priority {conn.priority}</span>
                </div>

                {h && (
                  <div className="tnum mt-3 grid grid-cols-3 gap-2 text-[11px]">
                    <div className="rounded-md bg-surface-2 px-2 py-1.5">
                      <div className="text-subtle">EWMA latency</div>
                      <div className="mt-0.5 font-medium text-text">{h.ewmaLatencyMs > 0 ? `${h.ewmaLatencyMs.toFixed(0)} ms` : '—'}</div>
                    </div>
                    <div className="rounded-md bg-surface-2 px-2 py-1.5">
                      <div className="text-subtle">EWMA TTFB</div>
                      <div className="mt-0.5 font-medium text-text">{h.ewmaTtfbMs > 0 ? `${h.ewmaTtfbMs.toFixed(0)} ms` : '—'}</div>
                    </div>
                    <div className="rounded-md bg-surface-2 px-2 py-1.5">
                      <div className="text-subtle">Failures</div>
                      <div className={`mt-0.5 font-medium ${h.consecutiveFailures > 0 ? 'text-danger' : 'text-text'}`}>{h.consecutiveFailures}</div>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </PageContainer>
  )
}
