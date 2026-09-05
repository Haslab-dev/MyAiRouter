import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer'
import ThinkingSection from '@/components/chat/ThinkingSection'
import { Badge } from '@/components/ui'
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
  defaultOpen?: boolean
}

export default function BenchmarkResult({ result, defaultOpen = false }: BenchmarkResultProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [copied, setCopied] = useState(false)
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
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="border-b border-border px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <code className="truncate font-mono text-xs font-semibold">{result.model}</code>
          <div className="flex items-center gap-1.5">
            {result.isStreaming && <Badge tone="accent">streaming</Badge>}
            {result.error ? <Badge tone="danger">failed</Badge> : !result.isStreaming && <Badge tone="success">done</Badge>}
            <button onClick={copy} className="text-muted transition-colors hover:text-text" aria-label="Copy output">
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        </div>
        <div className="tnum mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {stats.map((s) => (
            <div key={s.label} className="rounded bg-surface-2 px-1.5 py-1 text-center">
              <div className="text-[9px] uppercase tracking-wide text-subtle">{s.label}</div>
              <div className="text-[11px] font-medium">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {result.error ? (
        <div className="px-3.5 py-3 text-xs text-danger">{result.error}</div>
      ) : (
        <div className="px-3.5 py-2.5">
          <ThinkingSection reasoning={result.reasoning} isThinking={result.isThinking} />
          {isOpen && (
            <div className="max-h-96 overflow-y-auto">
              <MarkdownRenderer content={result.content || (result.isStreaming ? '…' : '(empty response)')} />
            </div>
          )}
          <button onClick={() => setIsOpen(!isOpen)} className="mt-1 text-[11px] text-accent hover:underline">
            {isOpen ? 'Collapse output' : 'Expand output'}
          </button>
        </div>
      )}
    </div>
  )
}
