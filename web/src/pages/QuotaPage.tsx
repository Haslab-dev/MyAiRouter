import { useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { useSnackbar } from '@/stores/snackbar'
import { Badge, Button, Card, PageContainer, PageHeader, Spinner, Toggle, EmptyState } from '@/components/ui'
import ProviderIcon from '@/components/ProviderIcon'
import GlmQuotaCard from '@/components/GlmQuotaCard'
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
        description="See how each connected provider is performing and pause any connection with one click."
        actions={
          <Button size="md" onClick={fetchAll}>
            <RefreshCw size={15} /> Refresh
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : error ? (
        <div className="py-16 text-center text-sm text-danger">{error}</div>
      ) : connections.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ShieldCheck size={32} />}
            title="No connected providers"
            hint="Connect a provider in the Providers menu to monitor its health here."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {connections.map((conn) => {
            const h = health[conn.id]
            const tone = healthTone(conn)
            const displayProvider = conn.provider.replace(/^(openai|anthropic)-compatible-/, '')
            return (
              <Card key={conn.id} className="flex flex-col justify-between gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProviderIcon id={conn.provider} name={displayProvider} size={38} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold capitalize text-text">{displayProvider}</div>
                      <div className="truncate text-xs text-muted">{conn.name || conn.email || 'Default key'}</div>
                    </div>
                  </div>
                  <Toggle
                    checked={conn.isActive}
                    onChange={() => handleToggleActive(conn.id, conn.isActive)}
                    label={`Enable or disable ${displayProvider}`}
                  />
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

      {connections
        .filter((c) => {
          const base = String(c.data?.baseUrl ?? '').toLowerCase()
          return c.provider === 'glm-coding' || c.provider === 'glm' || base.includes('bigmodel.cn') || base.includes('z.ai')
        })
        .map((c) => (
          <div key={`quota-${c.id}`} className="mt-5">
            <GlmQuotaCard connectionId={c.id} title={`${c.provider === 'glm-coding' ? 'GLM Coding Plan' : 'GLM'} Quota — ${c.name || 'Default'}`} />
          </div>
        ))}
    </PageContainer>
  )
}
