import { memo, useEffect, useRef, useState } from 'react'
import { Activity, Copy, Pause, Play, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button, EmptyState, PageHeader, Tabs } from '@/components/ui'
import { cn } from '@/lib/cn'

interface LogRecord {
  id?: string
  type: 'request' | 'error' | 'system'
  timestamp?: string
  method?: string
  path?: string
  status?: number
  duration?: string
  message?: string
  error?: string
  req_body?: string
  resp_body?: string
}

const truncate = (str: string | undefined, max = 150) => {
  if (!str) return ''
  if (str.length <= max) return str
  const half = Math.floor((max - 10) / 2)
  return `${str.slice(0, half)}…………${str.slice(-half)}`
}

const formatTimestamp = (ts?: string) => (ts ? (ts.split(' ').length >= 2 ? ts.split(' ')[1] : ts) : '')

const LogEntry = memo(function LogEntry({ entry }: { entry: LogRecord }) {
  const [expanded, setExpanded] = useState(false)
  const isRequest = entry.type === 'request'
  const isError = entry.type === 'error' || (entry.status ?? 0) >= 400
  const isSystem = entry.type === 'system'

  if (isSystem) {
    return (
      <div className="border-b border-border/60 px-3 py-1.5 text-[11px]">
        <span className="tnum text-subtle">{formatTimestamp(entry.timestamp)}</span>
        <span className="ml-2 text-muted">{entry.message}</span>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="border-b border-border/60 border-l-2 border-l-danger bg-danger-subtle px-3 py-1.5" onClick={() => setExpanded((v) => !v)}>
        <div className="flex items-center gap-2">
          <span className="tnum text-[10px] text-subtle">{formatTimestamp(entry.timestamp)}</span>
          <span className="rounded bg-danger px-1.5 py-px font-mono text-[10px] font-semibold text-on-accent">{entry.status ?? 'ERR'}</span>
          <span className="text-[11px] font-semibold text-danger">ERROR</span>
        </div>
        <div className={cn('mt-0.5 font-mono text-xs text-danger', !expanded && 'truncate')}>{expanded ? entry.error ?? entry.message : truncate(entry.error ?? entry.message ?? 'Unknown error')}</div>
      </div>
    )
  }

  if (!isRequest) return null

  return (
    <div className="cursor-pointer border-b border-border/60 px-3 py-1.5 transition-colors hover:bg-surface-2" onClick={() => setExpanded((v) => !v)}>
      <div className="flex items-center gap-2">
        <span className="tnum text-[10px] text-subtle">{formatTimestamp(entry.timestamp)}</span>
        <span className="w-14 shrink-0 font-mono text-[10px] font-semibold text-muted">{entry.method}</span>
        <code className={cn('min-w-0 flex-1 truncate font-mono text-xs', isError ? 'text-danger' : 'text-text')}>{entry.path}</code>
        <span className={cn('tnum shrink-0 text-[11px]', isError ? 'text-danger' : 'text-success')}>{entry.status}</span>
        {entry.duration && <span className="tnum shrink-0 text-[10px] text-subtle">{entry.duration}</span>}
      </div>
      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5">
          {entry.req_body && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg p-2 font-mono text-[10px] text-muted">{entry.req_body}</pre>
          )}
          {entry.resp_body && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg p-2 font-mono text-[10px] text-muted">{entry.resp_body}</pre>
          )}
        </div>
      )}
    </div>
  )
})

type Filter = 'all' | 'requests' | 'errors' | 'system'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'requests', label: 'Requests' },
  { id: 'errors', label: 'Errors' },
  { id: 'system', label: 'System' },
]

export default function ConsoleLogPage() {
  const [logs, setLogs] = useState<LogRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<Filter>('all')
  const [isPaused, setIsPaused] = useState(false)
  const perPage = 100
  const pageRef = useRef(page)
  pageRef.current = page

  const fetchLogs = async (p: number) => {
    try {
      const data = await api.get<{ logs: LogRecord[]; total: number }>(`/api/logs?page=${p}&perPage=${perPage}`)
      setLogs(data.logs ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      console.error('Error fetching logs:', err)
    }
  }

  useEffect(() => {
    if (isPaused) return
    fetchLogs(page)
    const interval = setInterval(() => {
      if (!document.hidden) fetchLogs(pageRef.current)
    }, 4000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaused, page])

  const handleClearLogs = async () => {
    if (!confirm('Clear all traffic logs?')) return
    try {
      await api.del('/api/logs')
      setLogs([])
      setTotal(0)
      setPage(1)
    } catch (err) {
      console.error('Error clearing logs:', err)
    }
  }

  const handleCopy = () => {
    const text = logs
      .map((l) => {
        if (l.type === 'request') {
          return `[${l.timestamp}] ${l.method} ${l.path} ${l.status ?? ''} ${l.duration ?? ''}\nREQ: ${l.req_body ?? ''}\nRESP: ${l.resp_body ?? ''}`
        }
        return `[${l.timestamp}] ${l.type === 'error' ? 'ERROR: ' : ''}${l.error ?? l.message ?? ''}`
      })
      .join('\n\n')
    navigator.clipboard.writeText(text)
  }

  const filtered = logs.filter((l) => {
    if (filter === 'all') return true
    if (filter === 'errors') return l.type === 'error' || (l.status ?? 0) >= 400
    if (filter === 'requests') return l.type === 'request'
    if (filter === 'system') return l.type === 'system'
    return true
  })

  const totalPages = Math.ceil(total / perPage)

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          title="Traffic"
          description={`${total.toLocaleString()} log entries — live request capture with full bodies on click.`}
          actions={
            <>
              <Tabs tabs={FILTERS.map((f) => ({ id: f.id, label: f.label }))} active={filter} onChange={(id) => setFilter(id as Filter)} />
              <Button size="sm" onClick={() => setIsPaused(!isPaused)}>
                {isPaused ? <Play size={13} /> : <Pause size={13} />}
                {isPaused ? 'Resume' : 'Pause'}
              </Button>
              <Button size="sm" onClick={handleClearLogs}>
                <Trash2 size={13} />
              </Button>
              <Button size="sm" variant="primary" onClick={handleCopy}>
                <Copy size={13} />
              </Button>
            </>
          }
        />
      </div>

      <div className="mx-6 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        {filtered.length === 0 ? (
          <EmptyState icon={<Activity size={26} />} title="No log entries" hint="Traffic through the gateway is captured here in real time." />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto font-mono">
            {filtered.map((entry, index) => (
              <LogEntry key={entry.id ?? index} entry={entry} />
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pb-4">
          <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Prev
          </Button>
          <span className="tnum text-[11px] text-muted">
            {page} / {totalPages}
          </span>
          <Button size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
