import { useEffect, useState } from 'react'
import { ArrowRight, GripVertical, Plus, Route as RouteIcon, Trash2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { useSnackbar } from '@/stores/snackbar'
import { Badge, Button, Card, Field, Input, PageContainer, PageHeader, Select, Modal, EmptyState } from '@/components/ui'
import type { AttemptPolicy, Combo, ComboKind, ModelEntry } from '@/lib/types'

interface StrategyInfo {
  label: string
  cost: string
  desc: string
  needsNonStream: boolean
}

const STRATEGY_DETAILS: Record<ComboKind, StrategyInfo> = {
  fallback: {
    label: 'Fallback Chain',
    cost: '1x tokens',
    desc: 'Tries models sequentially; moves to the next only if the primary fails. Best default.',
    needsNonStream: false,
  },
  smart: {
    label: 'Smart Route',
    cost: '1x tokens',
    desc: 'Classifies prompt intent (coding, long context, math, chat) to pick the optimal model first.',
    needsNonStream: false,
  },
  load_balance: {
    label: 'Load Balance',
    cost: '1x tokens',
    desc: 'Distributes requests round-robin across target models to bypass quota bottlenecks.',
    needsNonStream: false,
  },
  progressive: {
    label: 'Progressive',
    cost: '1x–2x tokens',
    desc: 'Queries the fast/cheap model first, runs a confidence check, escalates if output looks weak.',
    needsNonStream: false,
  },
  race: {
    label: 'Race (Hedged)',
    cost: 'Speculative',
    desc: 'Launches the primary model; hedges to the next after 400ms. First success wins. Requires stream:false.',
    needsNonStream: true,
  },
  parallel: {
    label: 'Parallel',
    cost: 'Multi-model',
    desc: 'Dispatches to all models at once and returns the fastest successful response. Requires stream:false.',
    needsNonStream: true,
  },
  ensemble: {
    label: 'Ensemble',
    cost: 'Multi-model',
    desc: 'Queries all models concurrently and keeps the strongest response. Requires stream:false.',
    needsNonStream: true,
  },
}

const DEFAULT_POLICY: AttemptPolicy = {
  attemptTimeoutMs: 3500,
  finalTimeoutMs: 60000,
  maxFallbacks: 0,
  fallbackPolicy: 'auto',
}

interface ModelPickerProps {
  availableModels: Record<string, ModelEntry[]>
  selected: string[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  onMove: (from: number, to: number) => void
}

function ModelPicker({ availableModels, selected, onAdd, onRemove, onMove }: ModelPickerProps) {
  const [query, setQuery] = useState('')

  const filtered = Object.values(availableModels).flatMap((models) =>
    (models ?? []).filter((m) => m.id.toLowerCase().includes(query.toLowerCase())),
  )

  return (
    <div>
      <Field label="Available models">
        <Input placeholder="Filter models…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </Field>
      <div className="mt-2 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
        {filtered.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onAdd(m.id)}
            disabled={selected.includes(m.id)}
            className="rounded border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted transition-colors enabled:hover:border-accent enabled:hover:text-text disabled:opacity-30"
          >
            {m.id}
          </button>
        ))}
        {filtered.length === 0 && <span className="py-2 text-xs text-subtle">No matching models.</span>}
      </div>

      {selected.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs font-medium text-muted">Priority order — top is tried first</div>
          <div className="flex flex-col gap-1.5">
            {selected.map((m, i) => (
              <div
                key={m}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = parseInt(e.dataTransfer.getData('text/plain'), 10)
                  if (!Number.isNaN(from) && from !== i) onMove(from, i)
                }}
                className="flex cursor-grab items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2"
              >
                <GripVertical size={13} className="text-subtle" />
                <span className="tnum w-6 text-[11px] text-subtle">#{i + 1}</span>
                <code className="font-mono text-xs font-medium">{m}</code>
                <button
                  type="button"
                  onClick={() => onRemove(m)}
                  className="ml-auto text-subtle transition-colors hover:text-danger"
                  aria-label={`Remove ${m}`}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function CombosPage() {
  const notify = useSnackbar((s) => s.notify)
  const [combos, setCombos] = useState<Combo[]>([])
  const [availableModels, setAvailableModels] = useState<Record<string, ModelEntry[]>>({})
  const [editorOpen, setEditorOpen] = useState(false)
  const [editCombo, setEditCombo] = useState<Combo | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ComboKind>('fallback')
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  const [policy, setPolicy] = useState<AttemptPolicy>(DEFAULT_POLICY)

  useEffect(() => {
    fetchCombos()
    fetchAvailableModels()
  }, [])

  const fetchCombos = async () => {
    try {
      setCombos((await api.get<Combo[]>('/api/combos')) ?? [])
    } catch (err) {
      console.error('Error fetching combos:', err)
    }
  }

  const fetchAvailableModels = async () => {
    try {
      const json = await api.get<{ data: ModelEntry[] }>('/v1/models')
      const grouped: Record<string, ModelEntry[]> = {}
      for (const m of json.data ?? []) {
        grouped[m.owned_by] = grouped[m.owned_by] ?? []
        grouped[m.owned_by].push(m)
      }
      setAvailableModels(grouped)
    } catch (err) {
      console.error('Error fetching models:', err)
    }
  }

  const openEditor = (combo?: Combo) => {
    if (combo) {
      setEditCombo(combo)
      setName(combo.name)
      setKind(combo.kind || 'fallback')
      setSelectedModels(combo.models || [])
      setPolicy({ ...DEFAULT_POLICY, ...(combo.policy ?? {}) })
    } else {
      setEditCombo(null)
      setName('')
      setKind('fallback')
      setSelectedModels([])
      setPolicy(DEFAULT_POLICY)
    }
    setEditorOpen(true)
  }

  const handleSubmit = async () => {
    if (!name.trim() || selectedModels.length === 0) return
    const payload = { name: name.trim(), kind, models: selectedModels, policy }
    try {
      if (editCombo) {
        await api.put(`/api/combos?id=${editCombo.id}`, payload)
        notify('Route updated', 'success')
      } else {
        await api.post('/api/combos', payload)
        notify('Route saved', 'success')
      }
      setEditorOpen(false)
      await fetchCombos()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save route', 'error')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this route?')) return
    try {
      await api.del(`/api/combos?id=${id}`)
      await fetchCombos()
      notify('Route deleted', 'info')
    } catch {
      notify('Failed to delete route', 'error')
    }
  }

  const moveModel = (from: number, to: number) => {
    const updated = [...selectedModels]
    const [moved] = updated.splice(from, 1)
    updated.splice(to, 0, moved)
    setSelectedModels(updated)
  }

  const strat = STRATEGY_DETAILS[kind]

  return (
    <PageContainer>
      <PageHeader
        title="Routes"
        description="Chain models behind one route key with fallback, balancing, or speculative strategies."
        actions={
          <Button variant="primary" size="md" onClick={() => openEditor()}>
            <Plus size={14} /> New route
          </Button>
        }
      />

      {combos.length === 0 ? (
        <Card>
          <EmptyState
            icon={<RouteIcon size={28} />}
            title="No active routes"
            hint="Create a route to chain backup models, balance load, or pick the best model per prompt."
            action={
              <Button variant="primary" size="sm" onClick={() => openEditor()}>
                <Plus size={13} /> New route
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {combos.map((combo) => {
            const info = STRATEGY_DETAILS[combo.kind] ?? STRATEGY_DETAILS.fallback
            return (
              <Card key={combo.id}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="accent">{info.label}</Badge>
                      <h3 className="font-mono text-sm font-semibold text-text">{combo.name}</h3>
                    </div>
                    <div className="mt-1 text-[11px] text-subtle">{info.cost}</div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" onClick={() => openEditor(combo)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-subtle hover:text-danger" onClick={() => handleDelete(combo.id)}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {(combo.models ?? []).map((m, i) => (
                    <span key={`${m}-${i}`} className="flex items-center gap-1.5">
                      <code className="rounded border border-border bg-surface-2 px-2 py-1 font-mono text-[11px]">{m}</code>
                      {i < (combo.models?.length ?? 0) - 1 && <ArrowRight size={12} className="text-subtle" />}
                    </span>
                  ))}
                </div>

                {combo.policy && (combo.policy.attemptTimeoutMs || combo.policy.fallbackPolicy || combo.policy.maxFallbacks || combo.policy.finalTimeoutMs) && (
                  <div className="tnum mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2.5 text-[11px] text-muted">
                    <span>
                      Attempt timeout <strong className="text-text">{combo.policy.attemptTimeoutMs ?? 3500}ms</strong>
                    </span>
                    <span>
                      Final timeout <strong className="text-text">{combo.policy.finalTimeoutMs ?? 60000}ms</strong>
                    </span>
                    {combo.policy.maxFallbacks ? (
                      <span>
                        Max fallbacks <strong className="text-text">{combo.policy.maxFallbacks}</strong>
                      </span>
                    ) : null}
                    <span>
                      Policy <strong className="text-text capitalize">{combo.policy.fallbackPolicy ?? 'auto'}</strong>
                    </span>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editCombo ? 'Edit route' : 'New route'}
        subtitle="Clients request the route key as the model name."
        width="max-w-2xl"
        footer={
          <>
            <Button onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!name.trim() || selectedModels.length === 0} onClick={handleSubmit}>
              {editCombo ? 'Update route' : 'Save route'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Route key">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. my-smart-route" />
            </Field>
            <Field label="Strategy">
              <Select value={kind} onChange={(e) => setKind(e.target.value as ComboKind)}>
                {Object.entries(STRATEGY_DETAILS).map(([key, info]) => (
                  <option key={key} value={key}>
                    {info.label} ({info.cost})
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5 text-xs text-muted">
            <strong className="text-text">{strat.label}</strong> — {strat.desc}
          </div>

          <ModelPicker
            availableModels={availableModels}
            selected={selectedModels}
            onAdd={(id) => !selectedModels.includes(id) && setSelectedModels([...selectedModels, id])}
            onRemove={(id) => setSelectedModels(selectedModels.filter((m) => m !== id))}
            onMove={moveModel}
          />

          <div className="border-t border-border pt-4">
            <div className="mb-3 text-xs font-semibold text-text">Attempt policy</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Attempt timeout (ms)" hint="Applied while more targets remain. Default 3500.">
                <Input
                  type="number"
                  min={500}
                  value={policy.attemptTimeoutMs ?? 3500}
                  onChange={(e) => setPolicy({ ...policy, attemptTimeoutMs: parseInt(e.target.value, 10) || 0 })}
                />
              </Field>
              <Field label="Final timeout (ms)" hint="Applied to the last target. Default 60000.">
                <Input
                  type="number"
                  min={1000}
                  value={policy.finalTimeoutMs ?? 60000}
                  onChange={(e) => setPolicy({ ...policy, finalTimeoutMs: parseInt(e.target.value, 10) || 0 })}
                />
              </Field>
              <Field label="Max fallbacks" hint="0 = unlimited (all targets).">
                <Input
                  type="number"
                  min={0}
                  value={policy.maxFallbacks ?? 0}
                  onChange={(e) => setPolicy({ ...policy, maxFallbacks: parseInt(e.target.value, 10) || 0 })}
                />
              </Field>
              <Field label="Fallback policy" hint="auto: 429/5xx/timeout retry, 400/401/403 stop.">
                <Select value={policy.fallbackPolicy ?? 'auto'} onChange={(e) => setPolicy({ ...policy, fallbackPolicy: e.target.value as AttemptPolicy['fallbackPolicy'] })}>
                  <option value="auto">Auto (recommended)</option>
                  <option value="aggressive">Aggressive — fall back on any error</option>
                  <option value="conservative">Conservative — only transient errors</option>
                </Select>
              </Field>
            </div>
          </div>
        </div>
      </Modal>
    </PageContainer>
  )
}
