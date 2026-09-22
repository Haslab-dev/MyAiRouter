import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer'
import ThinkingSection from '@/components/chat/ThinkingSection'
import { Badge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatNumber, type TokenUsageShape } from '@/lib/benchmarkTypes'

export interface BenchmarkRunResult {
  model: string
  content: string
  reasoning: string
  isStreaming: boolean
  isThinking: boolean
  error?: string
  latencyMs: number
  ttfbMs: number
  tokensPerSec: number
  usage: TokenUsageShape | null
  startedAt: number
}

interface BenchmarkResultProps {
  result: BenchmarkRunResult
  /** grid: fixed-height scrolling card; pane: full-height column for the side-by-side view */
  variant?: 'grid' | 'pane'
}

export default function BenchmarkResult({ result, variant = 'grid' }: BenchmarkResultProps) {
  const [copied, setCopied] = useState(false)
  const isPane = variant === 'pane'
  const stats = useMemo(
    () => [
      { label: 'Latency', value: `${(result.latencyMs / 1000).toFixed(2)}s` },
      { label: 'TTFB', value: `${result.ttfbMs}ms` },
      { label: 'Tok/s', value: formatNumber(result.tokensPerSec) },
      { label: 'Prompt', value: formatNumber(result.usage?.promptTokens) },
      { label: 'Output', value: formatNumber(result.usage?.completionTokens) },
      { label: 'Cached', value: formatNumber(result.usage?.cachedTokens) },
    ],
    [result],
  )

  const copy = () => {
    navigator.clipboard.writeText(result.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-lg border border-border bg-surface', isPane && 'h-full')}>
      {/* Header: model + status + copy */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <code className="truncate font-mono text-xs font-semibold">{result.model}</code>
        <div className="flex shrink-0 items-center gap-1.5">
          {result.isStreaming && <Badge tone="accent">streaming</Badge>}
          {result.error ? <Badge tone="danger">failed</Badge> : !result.isStreaming && <Badge tone="success">done</Badge>}
          <button onClick={copy} className="text-muted transition-colors hover:text-text" aria-label="Copy output">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      {/* Body: stats + always-expanded output */}
      <div className={cn('flex min-h-0 flex-1 flex-col px-3.5 py-2.5', result.error && 'justify-center')}>
        <div className="tnum grid shrink-0 grid-cols-3 gap-1.5 sm:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label} className="rounded bg-surface-2 px-1.5 py-1 text-center">
              <div className="text-[9px] uppercase tracking-wide text-subtle">{s.label}</div>
              <div className="text-[11px] font-medium">{s.value}</div>
            </div>
          ))}
        </div>

        <div className={cn('mt-2.5 min-h-0 flex-1', isPane ? 'overflow-y-auto' : 'overflow-y-auto max-h-[24rem]')}>
          {result.error ? (
            <p className="whitespace-pre-wrap break-words font-mono text-xs text-danger">{result.error}</p>
          ) : (
            <>
              <ThinkingSection reasoning={result.reasoning} isThinking={result.isThinking} />
              <MarkdownRenderer content={result.content || (result.isStreaming ? '…' : '(empty response)')} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
