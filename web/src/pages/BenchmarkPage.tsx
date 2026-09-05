import { useState } from 'react'
import { Play, X } from 'lucide-react'
import ProviderIcon from '@/components/ProviderIcon'
import BenchmarkResult, { type BenchmarkRunResult } from '@/components/chat/BenchmarkResult'
import { Button, Card, Field, Textarea } from '@/components/ui'
import { streamChatCompletion } from '@/lib/sse'
import type { ModelEntry } from '@/lib/types'

const MAX_MODELS = 3

export default function BenchmarkPage() {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [loadedModels, setLoadedModels] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [systemPrompt, setSystemPrompt] = useState('')
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<Record<string, BenchmarkRunResult>>({})

  const loadModels = async () => {
    try {
      const res = await fetch('/api/models')
      if (res.ok) {
        const data = await res.json()
        setModels(data.data ?? [])
        setLoadedModels(true)
      }
    } catch {
      /* handled by empty state */
    }
  }

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

        setResults((prev) => ({ ...prev, [modelId]: { model: modelId, content: '', reasoning: '', isStreaming: true, isThinking: false, latencyMs: 0, ttfbMs: 0, tokensPerSec: 0, usage: null, startedAt } }))

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

  if (!loadedModels) {
    return (
      <div className="px-6 py-6">
        <Button variant="primary" onClick={loadModels}>
          Load available models
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight text-text">Benchmark</h1>
        <p className="mt-1 text-[13px] text-muted">Run the same prompt against up to {MAX_MODELS} models side by side and compare latency, throughput, and output.</p>
      </div>

      <Card className="mb-5">
        <div className="mb-3">
          <span className="mb-1.5 block text-xs font-medium text-muted">Models ({selected.length}/{MAX_MODELS})</span>
          <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
            {models.map((m) => {
              const isSelected = selected.includes(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => toggleModel(m.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                    isSelected ? 'border-accent bg-accent-subtle text-accent' : 'border-border bg-surface-2 text-muted hover:text-text'
                  }`}
                >
                  <ProviderIcon id={m.owned_by} name={m.owned_by} size={14} />
                  <code className="font-mono">{m.id}</code>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="System prompt (optional)">
            <Textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="You are…" className="min-h-16" />
          </Field>
          <Field label="Prompt">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask the same question to all selected models…" className="min-h-16" />
          </Field>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button variant="primary" loading={running} disabled={!prompt.trim() || selected.length === 0} onClick={runBenchmark}>
            <Play size={13} /> Run benchmark
          </Button>
          {Object.keys(results).length > 0 && !running && (
            <Button variant="ghost" onClick={() => setResults({})}>
              <X size={13} /> Clear results
            </Button>
          )}
        </div>
      </Card>

      {Object.keys(results).length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {Object.values(results).map((r) => (
            <BenchmarkResult key={r.model} result={r} />
          ))}
        </div>
      )}
    </div>
  )
}
