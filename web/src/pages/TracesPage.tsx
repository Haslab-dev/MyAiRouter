import { useEffect, useMemo, useState } from 'react'
import { ScanSearch, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useSnackbar } from '@/stores/snackbar'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Spinner, type BadgeTone } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatCost, formatNumber, type FlatTrace, type TargetAttempt } from '@/lib/types'

const fmtLatency = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`)

/** Output throughput in tokens per second for a trace. */
const traceTokPerSec = (t: FlatTrace): number =>
  t.latencyMs > 0 ? t.outputTokens / (t.latencyMs / 1000) : 0

const routeTone: Record<string, BadgeTone> = {
  direct: 'neutral',
  fallback: 'accent',
  smart: 'success',
  load_balance: 'accent',
  progressive: 'warning',
  race: 'accent',
  parallel: 'accent',
  ensemble: 'accent',
}

function attemptStatusTone(status: TargetAttempt['status']): BadgeTone {
  if (status === 'success' || status === 'winner') return 'success'
  if (status === 'failed') return 'danger'
  return 'neutral'
}

function RouteGraph({ trace }: { trace: FlatTrace }) {
  const attempts = trace.targetAttempts ?? []
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">Route · {trace.route}</div>
      <div className="flex flex-col gap-1.5">
        {(attempts.length > 0
          ? attempts.map((a, i) => ({ key: `a${i}`, label: `${a.model} · ${a.connectionId.slice(0, 8)}`, status: a.status, detail: a.error || `${a.durationMs}ms${a.responseCode ? ` · HTTP ${a.responseCode}` : ''}` }))
          : (trace.routeNodes ?? []).map((n, i) => ({ key: `n${i}`, label: n, status: i + 1 === trace.attempt ? 'success' : 'skipped', detail: '' }))
        ).map((step, idx) => (
          <div key={step.key} className="flex items-center gap-2">
            <span className="tnum w-4 text-[10px] text-subtle">{idx + 1}</span>
            <span className={cn('h-1.5 w-1.5 rounded-full', step.status === 'success' || step.status === 'winner' ? 'bg-success' : step.status === 'failed' ? 'bg-danger' : 'bg-border-strong')} />
            <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{step.label}</code>
            {step.detail && <span className="max-w-[40%] truncate text-[10px] text-subtle">{step.detail}</span>}
            <Badge tone={attemptStatusTone(step.status as TargetAttempt['status'])}>{step.status}</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

function TraceDetail({ trace, onClose }: { trace: FlatTrace; onClose: () => void }) {
  return (
    <Card className="h-fit">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <code className="block truncate font-mono text-[13px] font-semibold">{trace.model}</code>
          <div className="tnum mt-0.5 text-[11px] text-subtle">
            {new Date(trace.timestamp).toLocaleString()} · {fmtLatency(trace.latencyMs)} · TTFB {trace.ttfbMs}ms
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Badge tone={trace.status === 'ok' ? 'success' : 'danger'}>{trace.status}</Badge>
        <Badge tone={routeTone[trace.route] ?? 'neutral'}>{trace.route}</Badge>
        {trace.isStream && <Badge>stream</Badge>}
        {trace.retryCount > 0 && <Badge tone="warning">{trace.retryCount} retries</Badge>}
        {trace.fallbackCount > 0 && <Badge tone="warning">{trace.fallbackCount} fallbacks</Badge>}
      </div>

      <div className="tnum mb-4 grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'Input', value: formatNumber(trace.inputTokens) },
          { label: 'Output', value: formatNumber(trace.outputTokens) },
          { label: 'Cached (upstream)', value: formatNumber(trace.cachedTokens) },
          { label: 'Cost', value: formatCost(trace.cost) },
          { label: 'TTFB', value: `${trace.ttfbMs} ms` },
          { label: 'Speed', value: `${traceTokPerSec(trace).toFixed(1)} tok/s` },
        ].map((s) => (
          <div key={s.label} className="rounded-md bg-surface-2 px-2 py-2">
            <div className="text-[10px] text-subtle">{s.label}</div>
            <div className="mt-0.5 text-[13px] font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      {trace.compression > 0 && (
        <div className="mb-4 rounded-md bg-surface-2 px-3 py-2 text-[11px] text-muted">
          Context compression applied: <strong className="text-text">{trace.compression}%</strong> saved (opt-in policy).
        </div>
      )}

      <RouteGraph trace={trace} />

      <div className="mt-4 rounded-lg border border-border p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">Pipeline</div>
        <div className="flex flex-col gap-1.5">
          {(trace.pipeline ?? []).map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  step.status === 'success' ? 'bg-success' : step.status === 'failed' ? 'bg-danger' : 'bg-border-strong',
                )}
              />
              <span className="w-28 shrink-0 font-medium text-text">{step.name}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{step.details}</span>
            </div>
          ))}
        </div>
      </div>

      {(trace.request || trace.response) && (
        <div className="mt-4 flex flex-col gap-2">
          {trace.request && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-subtle">Request preview</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-2.5 font-mono text-[11px] text-muted">{trace.request}</pre>
            </div>
          )}
          {trace.response && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-subtle">Response preview</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-2.5 font-mono text-[11px] text-muted">{trace.response}</pre>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export default function TracesPage() {
  const notify = useSnackbar((s) => s.notify)
  const [traces, setTraces] = useState<FlatTrace[]>([])
  const [selected, setSelected] = useState<FlatTrace | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const perPage = 20

  const fetchTraces = async (p: number) => {
    setIsLoading(true)
    try {
      const data = await api.get<{ traces: FlatTrace[]; total: number }>(`/api/traces?page=${p}&perPage=${perPage}`)
      setTraces(data.traces ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      console.error('Error fetching traces:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchTraces(1)
  }, [])

  const filtered = useMemo(
    () => traces.filter((t) => `${t.model} ${t.provider} ${t.route} ${t.status}`.toLowerCase().includes(searchQuery.toLowerCase())),
    [traces, searchQuery],
  )

  const totalPages = Math.max(1, Math.ceil(total / perPage))

  const handleReset = async () => {
    if (!confirm('Clear all trace data?')) return
    try {
      await api.del('/api/traces')
      notify('Trace data cleared', 'info')
      setSelected(null)
      await fetchTraces(1)
    } catch {
      notify('Failed to reset trace data', 'error')
    }
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <div className="shrink-0 px-6 pt-6">
        <PageHeader
          title="Traces"
          description="Per-request routing detail: attempt chains, pipeline steps, and token usage."
          actions={
            <Button size="sm" onClick={handleReset}>
              <Trash2 size={13} /> Clear all
            </Button>
          }
        />

        <div className="mb-4">
          <Input placeholder="Filter by model, provider, route…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="max-w-sm" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-5 px-6 pb-5">
        {/* Left: scrolling trace list */}
        <div className="flex w-[42%] min-w-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="flex flex-col gap-2">
              {isLoading ? (
                <div className="flex justify-center py-16">
                  <Spinner />
                </div>
              ) : filtered.length === 0 ? (
                <Card>
                  <EmptyState icon={<ScanSearch size={28} />} title="No traces yet" hint="Requests through the gateway appear here with their full routing chain." />
                </Card>
              ) : (
                filtered.map((trace) => (
                  <Card
                    key={trace.id}
                    interactive
                    onClick={() => setSelected(trace)}
                    className={cn(selected?.id === trace.id && 'border-accent')}
                    padded={false}
                  >
                    <div className="flex items-center gap-3 px-3.5 py-3">
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', trace.status === 'ok' ? 'bg-success' : 'bg-danger')} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <code className="truncate font-mono text-xs font-medium">{trace.model}</code>
                          <Badge tone={routeTone[trace.route] ?? 'neutral'}>{trace.route}</Badge>
                          {trace.fallbackCount > 0 && <Badge tone="warning">+{trace.fallbackCount} fallback</Badge>}
                        </div>
                        <div className="tnum mt-0.5 text-[10px] text-subtle">
                          {new Date(trace.timestamp).toLocaleTimeString()} · {fmtLatency(trace.latencyMs)} · {formatNumber(trace.inputTokens)}→{formatNumber(trace.outputTokens)} tok · {traceTokPerSec(trace).toFixed(1)} tok/s
                        </div>
                      </div>
                      <span className="tnum shrink-0 text-[11px] text-muted">{formatCost(trace.cost)}</span>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex shrink-0 items-center justify-center gap-1.5 border-t border-border pt-2">
              <Button size="sm" disabled={page <= 1} onClick={() => { setPage(page - 1); fetchTraces(page - 1) }}>
                Prev
              </Button>
              <span className="tnum text-[11px] text-muted">
                {page} / {totalPages}
              </span>
              <Button size="sm" disabled={page >= totalPages} onClick={() => { setPage(page + 1); fetchTraces(page + 1) }}>
                Next
              </Button>
            </div>
          )}
        </div>

        {/* Right: detail panel with its own scroll */}
        <div className="min-h-0 flex-1 overflow-y-auto pl-1">
          {selected ? (
            <TraceDetail trace={selected} onClose={() => setSelected(null)} />
          ) : (
            <Card className="h-fit">
              <EmptyState icon={<ScanSearch size={26} />} title="Select a trace" hint="Pick a request on the left to inspect its full routing chain." />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
