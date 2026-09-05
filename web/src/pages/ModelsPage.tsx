import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { useSnackbar } from '@/stores/snackbar'
import { Badge, Button, Card, Field, Input, Modal, PageContainer, PageHeader, Select, Table, Td, Toggle } from '@/components/ui'
import type { ModelConfig, ModelEntry, ProviderConnection } from '@/lib/types'

const isPrefixCacheSupported = (provider?: string) =>
  ['openai', 'deepseek', 'anthropic'].includes((provider ?? '').toLowerCase())

export default function ModelsPage() {
  const notify = useSnackbar((s) => s.notify)

  const [models, setModels] = useState<ModelEntry[]>([])
  const [policies, setPolicies] = useState<ModelConfig[]>([])
  const [providers, setProviders] = useState<ProviderConnection[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  const [editorOpen, setEditorOpen] = useState(false)
  const [activeModel, setActiveModel] = useState<ModelEntry | null>(null)
  const [primaryProvider, setPrimaryProvider] = useState('openai')
  const [fallbackModel, setFallbackModel] = useState('')
  const [compEnabled, setCompEnabled] = useState(false)
  const [compStrategy, setCompStrategy] = useState('balanced')
  const [compThreshold, setCompThreshold] = useState(64000)
  const [preserveRecent, setPreserveRecent] = useState(20)
  const [compTrigger, setCompTrigger] = useState<'threshold' | 'context_limit'>('threshold')

  useEffect(() => {
    fetchInitData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchInitData = async () => {
    try {
      const [modelsData, policiesData, providersData] = await Promise.all([
        api.get<{ data: ModelEntry[] }>('/v1/models').catch(() => ({ data: [] })),
        api.get<{ policies: ModelConfig[] }>('/api/models/policies').catch(() => ({ policies: [] })),
        api.get<ProviderConnection[]>('/api/providers').catch(() => []),
      ])
      setModels(modelsData.data ?? [])
      setPolicies(policiesData.policies ?? [])
      setProviders(providersData ?? [])
    } catch (err) {
      console.error('Error fetching models setup data:', err)
    }
  }

  const openEditor = (model: ModelEntry) => {
    setActiveModel(model)
    setPrimaryProvider(model.id.includes('/') ? model.id.split('/')[0] : 'openai')

    const policy = policies.find((p) => p.id === model.id)
    if (policy) {
      setFallbackModel(policy.routing?.fallback_model ?? policy.routing?.fallback_provider ?? '')
      setCompEnabled(policy.compression?.enabled ?? false)
      setCompStrategy(policy.compression?.strategy ?? 'balanced')
      setCompThreshold(policy.compression?.threshold_tokens ?? 64000)
      setCompTrigger((policy.compression?.trigger as 'threshold' | 'context_limit') ?? 'threshold')
      setPreserveRecent(policy.compression?.preserve_recent_messages ?? 20)
    } else {
      setFallbackModel('')
      setCompEnabled(false)
      setCompStrategy('balanced')
      setCompThreshold(64000)
      setCompTrigger('threshold')
      setPreserveRecent(20)
    }
    setEditorOpen(true)
  }

  const handleSave = async () => {
    if (!activeModel) return
    const payload = {
      id: activeModel.id,
      name: activeModel.id.includes('/') ? activeModel.id.split('/')[1] : activeModel.id,
      routing: {
        primary_provider: primaryProvider,
        fallback_model: fallbackModel || undefined,
      },
      compression: {
        enabled: compEnabled,
        strategy: compStrategy,
        threshold_tokens: compThreshold || 64000,
        trigger: compTrigger,
        preserve_recent_messages: preserveRecent || 20,
      },
    }
    try {
      await api.post('/api/models/policies', payload)
      notify(`Configuration saved for ${activeModel.id}`, 'success')
      setEditorOpen(false)
      fetchInitData()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to save configuration', 'error')
    }
  }

  const handleDeletePolicy = async (id: string) => {
    if (!confirm(`Reset configuration for ${id} to defaults?`)) return
    try {
      await api.del(`/api/models/policies?id=${encodeURIComponent(id)}`)
      notify('Configuration reset to defaults', 'info')
      fetchInitData()
    } catch {
      notify('Failed to reset configuration', 'error')
    }
  }

  const filteredModels = useMemo(
    () => models.filter((m) => m.id.toLowerCase().includes(searchQuery.toLowerCase())),
    [models, searchQuery],
  )

  const activeProviders = useMemo(
    () => Array.from(new Set((providers ?? []).filter((c) => c.isActive).map((c) => c.provider))),
    [providers],
  )

  return (
    <PageContainer>
      <PageHeader
        title="Models"
        description="Per-model routing policies: primary provider, fallback model, and optional context compression."
      />

      <div className="mb-4">
        <Input placeholder="Search models…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="max-w-md" />
      </div>

      <Card padded={false} className="overflow-hidden">
        <Table headers={['Model ID', 'Primary provider', 'Fallback model', 'Compression', '']}>
          {filteredModels.length === 0 ? (
            <tr>
              <Td colSpan={4} className="py-10 text-center text-subtle">
                No models found matching your search.
              </Td>
            </tr>
          ) : (
            filteredModels.map((model) => {
              const policy = policies.find((p) => p.id === model.id)
              const defaultProvider = model.id.includes('/') ? model.id.split('/')[0] : 'openai'
              const primary = policy?.routing?.primary_provider || defaultProvider
              const fallback = policy?.routing?.fallback_model ?? policy?.routing?.fallback_provider
              const comp = policy?.compression?.enabled

              return (
                <tr key={model.id} className="text-[13px]">
                  <Td>
                    <code className="font-mono text-xs font-medium">{model.id}</code>
                  </Td>
                  <Td>
                    <Badge tone="accent">{primary}</Badge>
                  </Td>
                  <Td>{fallback ? <code className="font-mono text-xs text-muted">{fallback}</code> : <span className="text-subtle">None</span>}</Td>
                  <Td>
                    {comp ? (
                      <span className="text-xs text-success">
                        Enabled ({policy?.compression?.strategy}, {(policy?.compression?.threshold_tokens ?? 0).toLocaleString()} tok)
                      </span>
                    ) : (
                      <span className="text-xs text-subtle">Disabled (pass-through)</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" onClick={() => openEditor(model)}>
                        Configure
                      </Button>
                      {policy && (
                        <Button size="sm" variant="ghost" onClick={() => handleDeletePolicy(model.id)}>
                          Reset
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              )
            })
          )}
        </Table>
      </Card>

      <Modal
        open={editorOpen && activeModel !== null}
        onClose={() => setEditorOpen(false)}
        title="Configure model"
        subtitle={activeModel?.id}
        width="max-w-xl"
        footer={
          <>
            <Button onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSave}>
              Save configuration
            </Button>
          </>
        }
      >
        {activeModel && (
          <div className="flex flex-col gap-5">
            <section>
              <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-subtle">Routing</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Primary provider">
                  <Select value={primaryProvider} onChange={(e) => setPrimaryProvider(e.target.value)}>
                    {Array.from(new Set([primaryProvider, ...activeProviders])).filter(Boolean).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Fallback model" hint="Used when the primary provider fails with a retryable error.">
                  <Select value={fallbackModel} onChange={(e) => setFallbackModel(e.target.value)}>
                    <option value="">None (disable fallback)</option>
                    {models
                      .filter((m) => m.id !== activeModel.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id}
                        </option>
                      ))}
                  </Select>
                </Field>
              </div>
            </section>

            <section className="border-t border-border pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Context compression</h4>
                <div className="flex items-center gap-2 text-xs text-muted">
                  Opt-in
                  <Toggle checked={compEnabled} onChange={setCompEnabled} label="Enable compression" />
                </div>
              </div>
              <div className="mb-3 flex items-start gap-2 rounded-md bg-warning-subtle px-3 py-2 text-[11px] text-warning">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>When enabled, the gateway rewrites the request body (history compression) before forwarding. Disabled models are forwarded byte-for-byte.</span>
              </div>
              {compEnabled && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Trigger">
                    <Select value={compTrigger} onChange={(e) => setCompTrigger(e.target.value as 'threshold' | 'context_limit')}>
                      <option value="threshold">Proactive (above token threshold)</option>
                      <option value="context_limit">Reactive (only over context limit)</option>
                    </Select>
                  </Field>
                  <Field label="Strategy">
                    <Select value={compStrategy} onChange={(e) => setCompStrategy(e.target.value)}>
                      <option value="light">Light</option>
                      <option value="balanced">Balanced</option>
                      <option value="aggressive">Aggressive</option>
                      <option value="extreme">Extreme</option>
                    </Select>
                  </Field>
                  {compTrigger === 'threshold' && (
                    <Field label="Threshold (tokens)">
                      <Input type="number" min={0} value={compThreshold} onChange={(e) => setCompThreshold(parseInt(e.target.value, 10) || 0)} />
                    </Field>
                  )}
                  <Field label="Preserve recent messages">
                    <Input type="number" min={0} value={preserveRecent} onChange={(e) => setPreserveRecent(parseInt(e.target.value, 10) || 0)} />
                  </Field>
                </div>
              )}
            </section>

            <section className="border-t border-border pt-4">
              <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-subtle">Upstream prompt cache</h4>
              {isPrefixCacheSupported(primaryProvider) ? (
                <div className="flex items-center gap-2 rounded-md bg-success-subtle px-3 py-2.5 text-xs">
                  <CheckCircle2 size={15} className="shrink-0 text-success" />
                  <div>
                    <div className="font-medium text-text">Prefix caching supported</div>
                    <div className="mt-0.5 text-[11px] text-muted">{primaryProvider} reports cached input tokens natively; the gateway never blocks it.</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-xs">
                  <XCircle size={15} className="shrink-0 text-subtle" />
                  <div>
                    <div className="font-medium text-text">Caching unavailable</div>
                    <div className="mt-0.5 text-[11px] text-muted">No prefix-caching information for {primaryProvider}. Gateway-side caching is intentionally not provided.</div>
                  </div>
                </div>
              )}
              <div className="mt-2 flex items-start gap-2 text-[11px] text-subtle">
                <Info size={12} className="mt-0.5 shrink-0" />
                <span>Prompt caching happens at the provider; client/agent tools own response caching.</span>
              </div>
            </section>
          </div>
        )}
      </Modal>
    </PageContainer>
  )
}
