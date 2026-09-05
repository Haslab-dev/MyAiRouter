import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { useSnackbar } from '@/stores/snackbar'
import { Badge, Button, Card, CardHeader, Field, Input, Modal, PageContainer, PageHeader, Select, StatCard, Tabs } from '@/components/ui'
import { formatCost, formatNumber, type ProviderConnection } from '@/lib/types'
import { cn } from '@/lib/cn'

interface UsageStats {
  totalRequests: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalCachedTokens: number
  totalCost: number
}

interface ChartPoint {
  label: string
  tokens: number
  cost: number
}

interface ModelSummaryRow {
  model: string
  provider: string
  requests: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  cost: number
}

const PERIODS = [
  { value: '', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
]

function LineChart({ data, mode }: { data: ChartPoint[]; mode: 'tokens' | 'cost' }) {
  if (data.length === 0) {
    return <div className="flex h-56 items-center justify-center text-xs text-subtle">No usage data for this period.</div>
  }

  const W = 640
  const H = 220
  const PAD_X = 8
  const PAD_Y = 16
  const values = data.map((d) => (mode === 'tokens' ? d.tokens : d.cost))
  const max = Math.max(...values, mode === 'tokens' ? 1 : 0.0001)
  const stepX = data.length > 1 ? (W - PAD_X * 2) / (data.length - 1) : 0

  const points = data.map((d, i) => {
    const v = mode === 'tokens' ? d.tokens : d.cost
    const x = PAD_X + i * stepX
    const y = H - PAD_Y - (v / max) * (H - PAD_Y * 2)
    return { x, y, ...d }
  })

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${path} L${points[points.length - 1].x.toFixed(1)},${H - PAD_Y} L${points[0].x.toFixed(1)},${H - PAD_Y} Z`
  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => H - PAD_Y - f * (H - PAD_Y * 2))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" preserveAspectRatio="none">
      {gridLines.map((y, i) => (
        <line key={i} x1={PAD_X} x2={W - PAD_X} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />
      ))}
      <path d={area} fill="var(--accent)" opacity="0.08" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2" fill="var(--accent)">
          <title>{`${p.label}: ${mode === 'tokens' ? formatNumber(p.tokens) + ' tok' : formatCost(p.cost)}`}</title>
        </circle>
      ))}
    </svg>
  )
}

export default function UsagePage() {
  const notify = useSnackbar((s) => s.notify)
  const [stats, setStats] = useState<UsageStats>({ totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0 })
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [modelSummaries, setModelSummaries] = useState<ModelSummaryRow[]>([])
  const [connections, setConnections] = useState<ProviderConnection[]>([])
  const [providerFilter, setProviderFilter] = useState('')
  const [period, setPeriod] = useState('')
  const [chartMode, setChartMode] = useState<'tokens' | 'cost'>('tokens')
  const [tableMode, setTableMode] = useState<'models' | 'providers'>('models')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showInject, setShowInject] = useState(false)
  const [injectRequests, setInjectRequests] = useState('0')
  const [injectPrompt, setInjectPrompt] = useState('0')
  const [injectCompletion, setInjectCompletion] = useState('0')
  const [injectCached, setInjectCached] = useState('0')

  const providers = useMemo(() => Array.from(new Set(connections.map((c) => c.provider))).sort(), [connections])
  const activeProviders = useMemo(() => new Set(connections.filter((c) => c.isActive).map((c) => c.provider)), [connections])

  const fetchData = useCallback(
    async (p: string, period_: string) => {
      const qs = (extra = '') => `?provider=${encodeURIComponent(p)}&period=${encodeURIComponent(period_)}${extra}`
      try {
        const [statsData, chart, modelRows] = await Promise.all([
          api.get<UsageStats>(`/api/usage/stats${qs()}`),
          api.get<ChartPoint[]>(`/api/usage/charts${qs()}`),
          api.get<ModelSummaryRow[]>(`/api/usage/models${qs()}`),
        ])
        setStats(statsData)
        setChartData(chart ?? [])
        setModelSummaries(modelRows ?? [])
      } catch (err) {
        console.error('Error loading usage:', err)
      }
    },
    [],
  )

  useEffect(() => {
    api.get<ProviderConnection[]>('/api/providers').then((c) => setConnections(c ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    fetchData(providerFilter, period)
    const interval = setInterval(() => {
      if (!document.hidden) fetchData(providerFilter, period)
    }, 15_000)
    return () => clearInterval(interval)
  }, [providerFilter, period, fetchData])

  const refresh = async () => {
    setIsRefreshing(true)
    await fetchData(providerFilter, period)
    setIsRefreshing(false)
  }

  const handleExport = async () => {
    try {
      const res = await fetch('/api/usage/export')
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `myairouter-usage-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      notify('Usage data exported', 'success')
    } catch {
      notify('Export failed', 'error')
    }
  }

  const handleInject = async () => {
    try {
      await api.post('/api/usage/inject', {
        totalRequests: parseInt(injectRequests, 10) || 0,
        totalPromptTokens: parseInt(injectPrompt, 10) || 0,
        totalCompletionTokens: parseInt(injectCompletion, 10) || 0,
        totalCachedTokens: parseInt(injectCached, 10) || 0,
      })
      notify('Usage injected', 'success')
      setShowInject(false)
      await fetchData(providerFilter, period)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Injection failed', 'error')
    }
  }

  // The API groups usage by (model, provider), so one model can appear in
  // several rows. Merge per model for the model table, and roll up by the
  // row's actual provider field for the provider table.
  const modelSummariesMerged = useMemo(() => {
    const map = new Map<string, ModelSummaryRow>()
    for (const row of modelSummaries) {
      const acc = map.get(row.model)
      if (!acc) {
        map.set(row.model, { ...row })
        continue
      }
      acc.requests += row.requests ?? 0
      acc.promptTokens += row.promptTokens ?? 0
      acc.completionTokens += row.completionTokens ?? 0
      acc.cachedTokens += row.cachedTokens ?? 0
      acc.cost += row.cost ?? 0
    }
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost || b.requests - a.requests)
  }, [modelSummaries])

  const providerSummaries = useMemo(() => {
    const map = new Map<string, { model: string; provider: string; requests: number; promptTokens: number; completionTokens: number; cachedTokens: number; cost: number; models: Set<string> }>()
    for (const row of modelSummaries) {
      const p = (row.provider ?? '').trim() || 'unknown'
      if (!map.has(p)) map.set(p, { model: p, provider: p, requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, models: new Set() })
      const acc = map.get(p)!
      acc.requests += row.requests ?? 0
      acc.promptTokens += row.promptTokens ?? 0
      acc.completionTokens += row.completionTokens ?? 0
      acc.cachedTokens += row.cachedTokens ?? 0
      acc.cost += row.cost ?? 0
      acc.models.add(row.model)
    }
    return Array.from(map.values())
      .map(({ models, ...rest }) => ({ ...rest, modelsCount: models.size }))
      .sort((a, b) => b.cost - a.cost || b.requests - a.requests)
  }, [modelSummaries])

  const totalTokens = stats.totalPromptTokens + stats.totalCompletionTokens
  const rows = tableMode === 'models' ? modelSummariesMerged : providerSummaries

  return (
    <PageContainer>
      <PageHeader
        title="Overview"
        description="Gateway usage, spend, and traffic distribution."
        actions={
          <>
            <Button size="sm" onClick={() => setShowInject(true)}>
              Inject
            </Button>
            <Button size="sm" onClick={handleExport}>
              <Download size={13} /> Export
            </Button>
            <Button size="sm" variant="primary" loading={isRefreshing} onClick={refresh}>
              <RefreshCw size={13} /> Refresh
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="w-44">
          <Select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
            <option value="">All providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="ml-2 flex flex-wrap items-center gap-1.5">
          {Array.from(activeProviders).map((p) => (
            <Badge key={p} tone="success">
              {p}
            </Badge>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Requests" value={formatNumber(stats.totalRequests)} />
        <StatCard label="Prompt tokens" value={formatNumber(stats.totalPromptTokens)} />
        <StatCard label="Completion tokens" value={formatNumber(stats.totalCompletionTokens)} />
        <StatCard label="Cached (upstream)" value={formatNumber(stats.totalCachedTokens)} hint="Reported by providers" tone="success" />
        <StatCard label="Cost" value={formatCost(stats.totalCost)} />
      </div>

      {/* Chart */}
      <Card className="mb-5">
        <CardHeader
          title="Usage over time"
          subtitle={`${formatNumber(totalTokens)} tokens total`}
          actions={
            <Tabs
              tabs={[
                { id: 'tokens', label: 'Tokens' },
                { id: 'cost', label: 'Cost' },
              ]}
              active={chartMode}
              onChange={(id) => setChartMode(id as 'tokens' | 'cost')}
            />
          }
        />
        <LineChart data={chartData} mode={chartMode} />
        <div className="tnum mt-2 flex justify-between text-[10px] text-subtle">
          <span>{chartData[0]?.label}</span>
          <span>{chartData[chartData.length - 1]?.label}</span>
        </div>
      </Card>

      {/* Breakdown table */}
      <Card padded={false}>
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Breakdown</h3>
            <Tabs
              tabs={[
                { id: 'models', label: 'By model' },
                { id: 'providers', label: 'By provider' },
              ]}
              active={tableMode}
              onChange={(id) => setTableMode(id as 'models' | 'providers')}
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-subtle">{tableMode === 'models' ? 'Model (provider)' : 'Provider'}</th>
                <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-subtle">Requests</th>
                <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-subtle">Prompt</th>
                <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-subtle">Completion</th>
                <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-subtle">Cached</th>
                <th className="px-4 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-subtle">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-subtle">
                    No usage recorded for this period.
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={`${row.model}-${i}`} className={cn('border-b border-border/60', i % 2 === 1 && 'bg-surface-2/40')}>
                    <td className="max-w-64 px-4 py-2.5">
                      <code className="block truncate font-mono text-xs">{row.model}</code>
                      {tableMode === 'models' && row.provider && (
                        <span className="text-[10px] text-subtle">{row.provider}</span>
                      )}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right">{formatNumber(row.requests)}</td>
                    <td className="tnum px-4 py-2.5 text-right text-muted">{formatNumber(row.promptTokens)}</td>
                    <td className="tnum px-4 py-2.5 text-right text-muted">{formatNumber(row.completionTokens)}</td>
                    <td className="tnum px-4 py-2.5 text-right text-muted">{formatNumber(row.cachedTokens)}</td>
                    <td className="tnum px-4 py-2.5 text-right font-medium">{formatCost(row.cost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={showInject}
        onClose={() => setShowInject(false)}
        title="Inject usage record"
        subtitle="Add a synthetic usage row for testing dashboards."
        footer={
          <>
            <Button onClick={() => setShowInject(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleInject}>
              Inject
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Total requests">
            <Input type="number" value={injectRequests} onChange={(e) => setInjectRequests(e.target.value)} />
          </Field>
          <Field label="Cached tokens">
            <Input type="number" value={injectCached} onChange={(e) => setInjectCached(e.target.value)} />
          </Field>
          <Field label="Prompt tokens">
            <Input type="number" value={injectPrompt} onChange={(e) => setInjectPrompt(e.target.value)} />
          </Field>
          <Field label="Completion tokens">
            <Input type="number" value={injectCompletion} onChange={(e) => setInjectCompletion(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </PageContainer>
  )
}
