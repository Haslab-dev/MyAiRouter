import { useEffect, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, ChevronDown, ChevronRight, GripVertical, Plus, Route as RouteIcon, Trash2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { useSnackbar } from '@/stores/snackbar'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageContainer, PageHeader, Select } from '@/components/ui'
import type { AttemptPolicy, Combo, ComboKind, ModelEntry } from '@/lib/types'

interface StrategyInfo {
  label: string
  cost: string
  desc: string
  needsNonStream: boolean
}

const STRATEGY_DETAILS: Partial<Record<ComboKind, StrategyInfo>> = {
  fallback: {
    label: 'Backup Chain',
    cost: 'Normal usage',
    desc: 'Uses your #1 model first. Automatically switches to #2 only if #1 fails or is busy.',
    needsNonStream: false,
  },
  load_balance: {
    label: 'Share Load',
    cost: 'Normal usage',
    desc: 'Rotates requests evenly across your models to avoid rate limits.',
    needsNonStream: false,
  },
  smart: {
    label: 'Smart Pick',
    cost: 'Normal usage',
    desc: 'Automatically picks the best model in your list for coding, math, long text, or chat.',
    needsNonStream: false,
  },
}

const DEFAULT_POLICY: AttemptPolicy = {
  attemptTimeoutMs: 3500,
  finalTimeoutMs: 300000,
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
    <div className="flex flex-col gap-4">
      <div>
        <Field label="2. Pick models to include" hint="Click any active model below to add it to this route.">
          <Input placeholder="Search models (e.g. deepseek, qwen, glm)…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <div className="mt-2.5 flex max-h-44 flex-wrap gap-2 overflow-y-auto rounded-lg border border-border bg-bg p-3">
          {filtered.map((m) => {
            const already = selected.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onAdd(m.id)}
                disabled={already}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-xs text-text transition-colors enabled:hover:border-accent enabled:hover:bg-accent-subtle enabled:hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-35"
              >
                {!already && <Plus size={12} className="text-accent" />}
                {m.id}
              </button>
            )
          })}
          {filtered.length === 0 && (
            <span className="py-3 text-xs text-subtle">
              No matching active models. Enable a provider first in the Providers menu.
            </span>
          )}
        </div>
      </div>

      {selected.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium text-muted">Priority order — #1 is tried first</div>
          <div className="flex flex-col gap-2">
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
                className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3.5 py-2.5"
              >
                <GripVertical size={15} className="shrink-0 cursor-grab text-subtle" aria-hidden="true" />
                <Badge tone={i === 0 ? 'accent' : 'neutral'}>#{i + 1}</Badge>
                <code className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-text">{m}</code>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => onMove(i, i - 1)}
                    aria-label={`Move ${m} up`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={i === selected.length - 1}
                    onClick={() => onMove(i, i + 1)}
                    aria-label={`Move ${m} down`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(m)}
                    aria-label={`Remove ${m}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-danger-subtle hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <X size={14} />
                  </button>
                </div>
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
  const [showAdvanced, setShowAdvanced] = useState(false)

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
      const json = await api.get<{ data: ModelEntry[] }>('/api/models')
      const grouped: Record<string, ModelEntry[]> = {}
      for (const m of json.data ?? []) {
        if (m.owned_by === 'combo') continue
        grouped[m.owned_by] = grouped[m.owned_by] ?? []
        grouped[m.owned_by].push(m)
      }
      setAvailableModels(grouped)
    } catch (err) {
      console.error('Error fetching models:', err)
    }
  }

  const openEditor = (combo?: Combo) => {
    fetchAvailableModels()
    setShowAdvanced(false)
    if (combo) {
      setEditCombo(combo)
      setName(combo.name)
      const validKind = combo.kind && STRATEGY_DETAILS[combo.kind] ? combo.kind : 'fallback'
      setKind(validKind)
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
        notify('Route created', 'success')
      }
      setEditorOpen(false)
      await fetchCombos()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save route', 'error')
    }
  }

  const handleDelete = async (combo: Combo) => {
    if (!confirm(`Delete route "${combo.name}"?`)) return
    try {
      await api.del(`/api/combos?id=${combo.id}`)
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

  const strat = STRATEGY_DETAILS[kind] ?? STRATEGY_DETAILS.fallback!

  return (
    <PageContainer>
      <PageHeader
        title="Routes"
        description="Group multiple models under one simple name — automatically switch to a backup if one is busy or down."
        actions={
          <Button variant="primary" size="lg" onClick={() => openEditor()}>
            <Plus size={16} /> New route
          </Button>
        }
      />

      {combos.length === 0 ? (
        <Card>
          <EmptyState
            icon={<RouteIcon size={32} />}
            title="No routes yet"
            hint="Create a route to combine models (for example DeepSeek + Qwen + GLM) behind one name."
            action={
              <Button variant="primary" size="md" onClick={() => openEditor()}>
                <Plus size={15} /> Create your first route
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {combos.map((combo) => {
            const info = STRATEGY_DETAILS[combo.kind] ?? STRATEGY_DETAILS.fallback!
            return (
              <Card key={combo.id} className="flex flex-col justify-between gap-4">
                <div>
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-mono text-base font-semibold text-text">{combo.name}</h3>
                        <Badge tone="accent">{info.label}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted">{info.desc}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg p-3">
                    {(combo.models ?? []).map((m, i) => (
                      <span key={`${m}-${i}`} className="flex items-center gap-2">
                        <code className="rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-xs text-text">
                          {m}
                        </code>
                        {i < (combo.models?.length ?? 0) - 1 && (
                          <ArrowRight size={14} className="text-subtle" aria-hidden="true" />
                        )}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <span className="text-xs text-subtle">{combo.models?.length ?? 0} model{(combo.models?.length ?? 0) === 1 ? '' : 's'} • {info.cost}</span>
                  <div className="flex items-center gap-2">
                    <Button size="md" variant="secondary" onClick={() => openEditor(combo)}>
                      Edit
                    </Button>
                    <Button
                      size="md"
                      variant="ghost"
                      className="text-danger hover:bg-danger-subtle hover:text-danger"
                      aria-label={`Delete route ${combo.name}`}
                      onClick={() => handleDelete(combo)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editCombo ? `Edit route — ${editCombo.name}` : 'Create a new route'}
        subtitle="Use the route name as the model name in your app or chat."
        width="max-w-2xl"
        footer={
          <>
            <Button size="md" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button size="md" variant="primary" disabled={!name.trim() || selectedModels.length === 0} onClick={handleSubmit}>
              {editCombo ? 'Save changes' : 'Save route'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="1. Route name" hint="Pick any short name, e.g. my-daily-ai">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. smart-coding" />
            </Field>
            <Field label="How should it choose?">
              <Select value={kind} onChange={(e) => setKind(e.target.value as ComboKind)}>
                {Object.entries(STRATEGY_DETAILS).map(([key, info]) =>
                  info ? (
                    <option key={key} value={key}>
                      {info.label}
                    </option>
                  ) : null,
                )}
              </Select>
            </Field>
          </div>

          <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-xs leading-relaxed text-muted">
            <strong className="text-text">{strat.label}:</strong> {strat.desc}
            {strat.needsNonStream && (
              <span className="mt-1 block text-[11px] text-subtle">
                Note: For streaming chats, this automatically runs sequentially so responses stream smoothly.
              </span>
            )}
          </div>

          <ModelPicker
            availableModels={availableModels}
            selected={selectedModels}
            onAdd={(id) => !selectedModels.includes(id) && setSelectedModels([...selectedModels, id])}
            onRemove={(id) => setSelectedModels(selectedModels.filter((m) => m !== id))}
            onMove={moveModel}
          />

          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Advanced timing & retry settings (optional)
            </button>

            {showAdvanced && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Switch timeout (ms)" hint="Wait time before trying next model if no response starts. Default 3500.">
                  <Input
                    type="number"
                    min={500}
                    value={policy.attemptTimeoutMs ?? 3500}
                    onChange={(e) => setPolicy({ ...policy, attemptTimeoutMs: parseInt(e.target.value, 10) || 0 })}
                  />
                </Field>
                <Field label="Final timeout (ms)" hint="Max wait for the last model. Default 300000 (5 min).">
                  <Input
                    type="number"
                    min={1000}
                    value={policy.finalTimeoutMs ?? 300000}
                    onChange={(e) => setPolicy({ ...policy, finalTimeoutMs: parseInt(e.target.value, 10) || 0 })}
                  />
                </Field>
                <Field label="Max retries" hint="0 = try every model in the list.">
                  <Input
                    type="number"
                    min={0}
                    value={policy.maxFallbacks ?? 0}
                    onChange={(e) => setPolicy({ ...policy, maxFallbacks: parseInt(e.target.value, 10) || 0 })}
                  />
                </Field>
                <Field label="Retry rule" hint="Auto retries busy/server errors and stops on bad requests.">
                  <Select value={policy.fallbackPolicy ?? 'auto'} onChange={(e) => setPolicy({ ...policy, fallbackPolicy: e.target.value as AttemptPolicy['fallbackPolicy'] })}>
                    <option value="auto">Auto (recommended)</option>
                    <option value="aggressive">Aggressive — retry on any error</option>
                    <option value="conservative">Conservative — temporary errors only</option>
                  </Select>
                </Field>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </PageContainer>
  )
}
