import { useEffect, useState } from 'react'
import { ChevronDown, Play, X } from 'lucide-react'
import ProviderIcon from '@/components/ProviderIcon'
import BenchmarkResult, { type BenchmarkRunResult } from '@/components/chat/BenchmarkResult'
import { api } from '@/lib/api'
import { Button, Card, Field, Tabs, Textarea } from '@/components/ui'
import { streamChatCompletion } from '@/lib/sse'
import { cn } from '@/lib/cn'
import type { ModelEntry } from '@/lib/types'

const MAX_MODELS = 3

export default function BenchmarkPage() {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [modelsOpen, setModelsOpen] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'side'>('grid')
  const [results, setResults] = useState<Record<string, BenchmarkRunResult>>({})

  useEffect(() => {
    api
      .get<{ data: ModelEntry[] }>('/api/models')
      .then((data) => {
        const seen = new Set<string>()
        setModels((data.data ?? []).filter((m) => (seen.has(m.id) ? false : seen.add(m.id))))
      })
      .catch(() => setModels([]))
  }, [])

  const toggleModel = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((m) => m !== id)
      if (prev.length >= MAX_MODELS) return [...prev.slice(1), id]
      return [...prev, id]
    })
  }

  const runBenchmark = async () => {
    if (!prompt.trim() || selected.length === 0 || running) return
    setRunning(true)
    setResults({})

    await Promise.all(
      selected.map(async (modelId) => {
        const startedAt = Date.now()
        let ttfbMs = 0
        let content = ''
        let reasoning = ''
        let isThinking = false

        setResults((prev) => ({
          ...prev,
          [modelId]: { model: modelId, content: '', reasoning: '', isStreaming: true, isThinking: false, latencyMs: 0, ttfbMs: 0, tokensPerSec: 0, usage: null, startedAt },
        }))

        try {
          const apiMessages: Array<Record<string, unknown>> = []
          if (systemPrompt.trim()) apiMessages.push({ role: 'system', content: systemPrompt.trim() })
          apiMessages.push({ role: 'user', content: prompt.trim() })

          const outcome = await streamChatCompletion(
            { model: modelId, messages: apiMessages },
            {
              onEvent: (event) => {
                if (ttfbMs === 0 && (event.content || event.reasoning)) ttfbMs = Date.now() - startedAt
                if (event.reasoning) {
                  isThinking = true
                  reasoning += event.reasoning
                }
                if (event.content) {
                  isThinking = false
                  content += event.content
                }
                const elapsed = (Date.now() - startedAt) / 1000
                setResults((prev) => ({
                  ...prev,
                  [modelId]: {
                    model: modelId,
                    content,
                    reasoning,
                    isStreaming: true,
                    isThinking,
                    error: event.error,
                    latencyMs: Date.now() - startedAt,
                    ttfbMs,
                    tokensPerSec: elapsed > 0 ? content.split(/\s+/).length / elapsed : 0,
                    usage: null,
                    startedAt,
                  },
                }))
              },
            },
          )

          const latencyMs = Date.now() - startedAt
          const outTokens = outcome.usage?.completionTokens ?? content.split(/\s+/).length
          setResults((prev) => ({
            ...prev,
            [modelId]: {
              model: modelId,
              content: outcome.content,
              reasoning: outcome.reasoning,
              isStreaming: false,
              isThinking: false,
              latencyMs,
              ttfbMs,
              tokensPerSec: latencyMs > 0 ? outTokens / (latencyMs / 1000) : 0,
              usage: outcome.usage,
              startedAt,
            },
          }))
        } catch (err) {
          setResults((prev) => ({
            ...prev,
            [modelId]: {
              model: modelId,
              content: '',
              reasoning,
              isStreaming: false,
              isThinking: false,
              error: err instanceof Error ? err.message : String(err),
              latencyMs: Date.now() - startedAt,
              ttfbMs,
              tokensPerSec: 0,
              usage: null,
              startedAt,
            },
          }))
        }
      }),
    )

    setRunning(false)
  }

  const selectedModels = models.filter((m) => selected.includes(m.id))
  const availableModels = models.filter((m) => !selected.includes(m.id))
  const resultList = Object.values(results)

  const chipClass = (isSelected: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${
      isSelected ? 'border-accent bg-accent-subtle text-accent' : 'border-border bg-surface-2 text-muted hover:border-border-strong hover:text-text'
    }`

  return (
    <div className="mx-auto max-w-[1500px] px-6 py-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-text">Benchmark</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            Run the same prompt against up to {MAX_MODELS} models and compare latency, throughput, and output.
          </p>
        </div>
        <Tabs
          tabs={[
            { id: 'grid', label: 'Grid' },
            { id: 'side', label: 'Side by side' },
          ]}
          active={viewMode}
          onChange={(id) => setViewMode(id as 'grid' | 'side')}
        />
      </div>

      {/* Model selection — collapsible */}
      <Card className="mb-4">
        <button className="flex w-full items-center justify-between gap-3" onClick={() => setModelsOpen((v) => !v)}>
          <span className="text-[13px] font-semibold text-text">
            Models <span className="tnum font-normal text-muted">({selected.length}/{MAX_MODELS})</span>
          </span>
          <ChevronDown size={15} className={cn('shrink-0 text-muted transition-transform', modelsOpen && 'rotate-180')} />
        </button>

        {selectedModels.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {selectedModels.map((m) => (
              <button key={m.id} onClick={() => toggleModel(m.id)} className={cn(chipClass(true), 'group')}>
                <ProviderIcon id={m.owned_by} name={m.owned_by} size={14} />
                <code className="font-mono">{m.id}</code>
                <X size={11} className="opacity-60 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
          </div>
        )}

        {modelsOpen && (
          <div className="mt-3 max-h-44 overflow-y-auto border-t border-border pt-3">
            {availableModels.length === 0 ? (
              <p className="py-1 text-xs text-subtle">All available models are selected.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {availableModels.map((m) => (
                  <button key={m.id} onClick={() => toggleModel(m.id)} className={chipClass(false)}>
                    <ProviderIcon id={m.owned_by} name={m.owned_by} size={14} />
                    <code className="font-mono">{m.id}</code>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedModels.length === 0 && !modelsOpen && (
          <p className="mt-2 text-xs text-subtle">Open the list and pick up to {MAX_MODELS} models to compare.</p>
        )}
      </Card>

      {/* Prompts in one row + actions */}
      <Card className="mb-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="System prompt (optional)">
            <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="You are…" className="min-h-24" />
          </Field>
          <Field label="Prompt">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask the same question to all selected models…" className="min-h-24" />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button variant="primary" loading={running} disabled={!prompt.trim() || selected.length === 0} onClick={runBenchmark}>
            <Play size={13} /> Run benchmark
          </Button>
          {resultList.length > 0 && !running && (
            <Button variant="ghost" onClick={() => setResults({})}>
              <X size={13} /> Clear results
            </Button>
          )}
        </div>
      </Card>

      {/* Results */}
      {resultList.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-14 text-center text-xs text-subtle">
          Run the benchmark to compare results here.
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid items-start gap-4 md:grid-cols-2 min-[1200px]:grid-cols-3">
          {resultList.map((r) => (
            <BenchmarkResult key={r.model} result={r} />
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2" style={{ height: 'calc(100vh - 26rem)', minHeight: 420 }}>
          {resultList.map((r) => (
            <div key={r.model} className="h-full min-w-[340px] shrink-0" style={{ width: 'max(340px, calc((100vw - 16rem) / 3))' }}>
              <BenchmarkResult result={r} variant="pane" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
