import { useCallback, useEffect, useState } from 'react'
import { Clock, RefreshCw, Sparkles } from 'lucide-react'
import { api } from '@/lib/api'
import { Badge, Button, Card } from '@/components/ui'
import { formatNumber } from '@/lib/types'
import { cn } from '@/lib/cn'

interface QuotaLimitItem {
  type?: string
  unit?: number
  number?: number
  usage?: number
  currentValue?: number
  remaining?: number
  percentage?: number
  nextResetTime?: number
}

interface ProviderQuotaResponse {
  supported: boolean
  provider: string
  endpoint?: string
  upstreamOk?: boolean
  upstreamError?: string
  limits?: QuotaLimitItem[]
  local?: {
    tokens5h: number
    requests5h: number
    tokens7d: number
    requests7d: number
  }
}

function formatResetCountdown(tsMs?: number): string {
  if (!tsMs || tsMs <= 0) return ''
  const diffSec = Math.max(0, Math.round((tsMs - Date.now()) / 1000))
  if (diffSec < 60) return `resets in ${diffSec}s`
  const mins = Math.floor(diffSec / 60)
  if (mins < 60) return `resets in ${mins}m`
  const hrs = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hrs < 24) return `resets in ${hrs}h ${remMins}m`
  const days = Math.floor(hrs / 24)
  return `resets in ${days}d ${hrs % 24}h`
}

function limitLabel(item: QuotaLimitItem, index: number): string {
  if (item.type === 'TOKENS_LIMIT') {
    if (item.number && item.unit === 3) return `${item.number}-Hour Token Window`
    if (item.number && item.unit === 6) return `${item.number}-Day Token Window`
    return 'Token Quota Window'
  }
  if (item.type === 'TIME_LIMIT') {
    return 'MCP / Web Tool Quota'
  }
  return item.type || `Quota Window #${index + 1}`
}

export default function GlmQuotaCard({ connectionId, title = 'GLM Coding Plan Quota' }: { connectionId: string; title?: string }) {
  const [data, setData] = useState<ProviderQuotaResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const loadQuota = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<ProviderQuotaResponse>(`/api/providers/${connectionId}/quota`)
      setData(res)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  useEffect(() => {
    loadQuota()
  }, [loadQuota])

  if (!loading && data && !data.supported) return null

  const limits = Array.isArray(data?.limits) ? data.limits : []

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/40 bg-accent-subtle text-accent">
            <Sparkles size={15} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text">{title}</h3>
              {data?.upstreamOk ? (
                <Badge tone="success">Live</Badge>
              ) : data ? (
                <Badge tone="warning">Local estimate</Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted">5-hour rolling token window &amp; plan usage.</p>
          </div>
        </div>

        <Button size="sm" loading={loading} onClick={loadQuota}>
          <RefreshCw size={13} /> Refresh quota
        </Button>
      </div>

      {limits.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {limits.map((item, idx) => {
            const pct = Math.min(100, Math.max(0, Number(item.percentage ?? 0)))
            const tone = pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-accent'
            const resetText = formatResetCountdown(item.nextResetTime)
            return (
              <div key={`${item.type ?? 'limit'}-${idx}`} className="rounded-lg border border-border bg-bg p-3.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-text">{limitLabel(item, idx)}</span>
                  <span className="tnum text-xs font-semibold text-text">{pct.toFixed(1)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                  <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
                </div>
                <div className="tnum mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                  <span>
                    {item.currentValue !== undefined && item.usage !== undefined
                      ? `${formatNumber(item.currentValue)} / ${formatNumber(item.usage)}`
                      : item.remaining !== undefined
                        ? `${formatNumber(item.remaining)} remaining`
                        : 'Active window'}
                  </span>
                  {resetText && (
                    <span className="inline-flex items-center gap-1 text-subtle">
                      <Clock size={11} />
                      {resetText}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : data && !data.upstreamOk && data.upstreamError ? (
        <div className="rounded-lg border border-border bg-bg px-3.5 py-2.5 text-xs text-muted">
          Upstream quota monitor returned <code className="font-mono text-text">{data.upstreamError}</code> — showing local gateway usage below.
        </div>
      ) : null}

      {data?.local && (
        <div className="tnum grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-bg px-3 py-2.5">
            <div className="text-[11px] text-subtle">Local 5h tokens</div>
            <div className="mt-0.5 text-sm font-semibold text-text">{formatNumber(data.local.tokens5h)}</div>
          </div>
          <div className="rounded-lg border border-border bg-bg px-3 py-2.5">
            <div className="text-[11px] text-subtle">Local 5h requests</div>
            <div className="mt-0.5 text-sm font-semibold text-text">{formatNumber(data.local.requests5h)}</div>
          </div>
          <div className="rounded-lg border border-border bg-bg px-3 py-2.5">
            <div className="text-[11px] text-subtle">Local 7d tokens</div>
            <div className="mt-0.5 text-sm font-semibold text-text">{formatNumber(data.local.tokens7d)}</div>
          </div>
          <div className="rounded-lg border border-border bg-bg px-3 py-2.5">
            <div className="text-[11px] text-subtle">Local 7d requests</div>
            <div className="mt-0.5 text-sm font-semibold text-text">{formatNumber(data.local.requests7d)}</div>
          </div>
        </div>
      )}
    </Card>
  )
}
