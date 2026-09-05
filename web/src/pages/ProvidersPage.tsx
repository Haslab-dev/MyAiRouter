import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Brain, KeyRound, Pencil, Plus, RefreshCw, Trash2, Zap } from 'lucide-react'
import { api } from '@/lib/api'
import { useSnackbar } from '@/stores/snackbar'
import ProviderIcon from '@/components/ProviderIcon'
import { Badge, Button, Card, Field, Input, Modal, PageContainer, PageHeader, Select, Spinner, Toggle } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { ModelEntry, ProviderConnection } from '@/lib/types'

interface ProviderNode {
  id: string
  type: string
  name: string
  data: { baseUrl?: string; apiKey?: string }
}

interface CustomModel {
  id: string
  providerAlias: string
  name: string
  type: string
}

interface UsageLog {
  provider?: string
  connectionId?: string
  status: string
  meta?: string
}

interface ProviderMetrics {
  requests: number
  successRate: string
  avgLatency: string
  status: 'Healthy' | 'Degraded'
}

const CORE_PROVIDERS = [
  { id: 'kilocode', name: 'Kilo Code', type: 'oauth', desc: 'Secure authorization code login' },
  { id: 'opencode-go', name: 'OpenCode Go', type: 'apikey', desc: 'Fast, secure open code credentials' },
  { id: 'opencode-zen', name: 'OpenCode Zen', type: 'apikey', desc: 'Custom code generation engine' },
  { id: 'kenari', name: 'Kenari', type: 'apikey', desc: 'Kenari AI intelligent routing' },
  { id: 'sumopod', name: 'Sumopod', type: 'apikey', desc: 'Sumopod high-performance endpoints' },
  { id: 'mistral', name: 'Mistral AI', type: 'apikey', desc: 'Frontier AI models by Mistral' },
  { id: 'meta', name: 'Meta AI', type: 'apikey', desc: 'Meta Llama foundation models' },
  { id: 'ollama', name: 'Ollama', type: 'apikey', desc: 'Local & server inference engine' },
  { id: 'qwen', name: 'Qwen', type: 'apikey', desc: 'Alibaba Cloud Tongyi Qianwen' },
  { id: 'tencent', name: 'Tencent Hunyuan', type: 'apikey', desc: 'Tencent Cloud Hunyuan LLMs' },
  { id: 'vercel', name: 'Vercel AI', type: 'apikey', desc: 'Vercel AI Gateway integration' },
  { id: 'fireworks', name: 'Fireworks AI', type: 'apikey', desc: 'Fast generative AI inference' },
  { id: 'cloudflare-ai', name: 'Cloudflare AI', type: 'apikey', desc: 'Cloudflare Workers AI platform' },
  { id: 'glm', name: 'GLM API', type: 'apikey', desc: 'General LLM access keys' },
  { id: 'glm-coding', name: 'GLM Coding Plan', type: 'apikey', desc: 'Targeted coding intelligence' },
  { id: 'nvidia', name: 'NVIDIA NIM', type: 'apikey', desc: 'NVIDIA API Catalog & NIM endpoints' },
  { id: 'groq', name: 'Groq', type: 'apikey', desc: 'LPU inference engine for fast LLMs' },
  { id: 'openrouter', name: 'OpenRouter', type: 'apikey', desc: 'Unified API for top AI models' },
  { id: 'deepseek', name: 'DeepSeek', type: 'apikey', desc: 'DeepSeek AI reasoning & chat models' },
  { id: 'cerebras', name: 'Cerebras', type: 'apikey', desc: 'Ultra-fast inference on Cerebras hardware' },
] as const

const PROVIDER_URLS: Record<string, string> = {
  'opencode-go': 'https://opencode.ai/zen/go/v1',
  'opencode-zen': 'https://opencode.ai/zen/v1',
  kenari: 'https://kenari.id/v1',
  sumopod: 'https://ai.sumopod.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  meta: 'https://api.meta.ai/v1',
  ollama: 'http://localhost:11434/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  tencent: 'https://api.hunyuan.cloud.tencent.com/v1',
  vercel: 'https://api.vercel.ai/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  'cloudflare-ai': 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  'glm-coding': 'https://open.bigmodel.cn/api/coding/paas/v4',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  cerebras: 'https://api.cerebras.ai/v1',
}

interface HeaderRow {
  key: string
  value: string
}

interface CredentialEditorProps {
  title: string
  providerId: string
  existing?: ProviderConnection
  defaultBaseUrl: string
  onDone: () => void
  onCancel: () => void
}

function CredentialEditor({ title, providerId, existing, defaultBaseUrl, onDone, onCancel }: CredentialEditorProps) {
  const notify = useSnackbar((s) => s.notify)
  const [credName, setCredName] = useState(existing?.name ?? '')
  const [credKey, setCredKey] = useState(existing?.data?.apiKey ?? '')
  const [credPriority, setCredPriority] = useState(existing?.priority ?? 1)
  const [customHeaders, setCustomHeaders] = useState<HeaderRow[]>(() => {
    const hdrs = existing?.data?.headers ?? {}
    const list = Object.keys(hdrs).map((k) => ({ key: k, value: String(hdrs[k]) }))
    return list.length > 0 ? list : [{ key: '', value: '' }]
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!credKey.trim()) {
      notify('API key is required', 'error')
      return
    }
    const headersMap: Record<string, string> = {}
    for (const h of customHeaders) {
      if (h.key.trim() && h.value.trim()) headersMap[h.key.trim()] = h.value.trim()
    }
    const payload = existing
      ? {
          name: credName || 'ProdKey',
          priority: credPriority || 1,
          data: { apiKey: credKey, baseUrl: existing.data?.baseUrl || defaultBaseUrl, headers: headersMap },
        }
      : {
          id: `${providerId}-conn-${Date.now()}`,
          provider: providerId,
          authType: 'apikey',
          name: credName || 'ProdKey',
          email: '',
          priority: credPriority || 1,
          isActive: true,
          data: { apiKey: credKey, baseUrl: defaultBaseUrl, headers: headersMap },
        }
    setSaving(true)
    try {
      if (existing) {
        await api.patch(`/api/providers/${existing.id}`, payload)
      } else {
        await api.post('/api/providers', payload)
      }
      notify(existing ? 'Credentials updated' : 'Credentials saved', 'success')
      onDone()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Error saving credentials', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      subtitle={providerId}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {existing ? 'Update credentials' : 'Save credentials'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Label">
          <Input value={credName} onChange={(e) => setCredName(e.target.value)} placeholder="e.g. ProdKey" />
        </Field>
        <Field label="API key">
          <Input type="password" value={credKey} onChange={(e) => setCredKey(e.target.value)} placeholder="sk-…" />
        </Field>
        <Field label="Priority" hint="Lower number = tried first within the provider.">
          <Input type="number" min={1} value={credPriority} onChange={(e) => setCredPriority(parseInt(e.target.value, 10) || 1)} />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Custom headers</span>
            <Button size="sm" variant="ghost" onClick={() => setCustomHeaders([...customHeaders, { key: '', value: '' }])}>
              <Plus size={12} /> Add
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            {customHeaders.map((h, i) => (
              <div key={i} className="flex gap-1.5">
                <Input placeholder="Header" value={h.key} onChange={(e) => setCustomHeaders(customHeaders.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                <Input placeholder="Value" value={h.value} onChange={(e) => setCustomHeaders(customHeaders.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <Button size="sm" variant="ghost" onClick={() => setCustomHeaders(customHeaders.filter((_, j) => j !== i))}>
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default function ProvidersPage() {
  const notify = useSnackbar((s) => s.notify)
  const [connections, setConnections] = useState<ProviderConnection[]>([])
  const [nodes, setNodes] = useState<ProviderNode[]>([])
  const [customModels, setCustomModels] = useState<CustomModel[]>([])
  const [providerModels, setProviderModels] = useState<Record<string, ModelEntry[]>>({})
  const [detailedLogs, setDetailedLogs] = useState<UsageLog[]>([])
  const [providerSearchQuery, setProviderSearchQuery] = useState('')

  const [viewingDetailProvider, setViewingDetailProvider] = useState<{ id: string; name: string; type: string; baseUrl: string; isNode: boolean } | null>(null)
  const [modelPrefix, setModelPrefix] = useState('')

  const [credEditor, setCredEditor] = useState<{ providerId: string; title: string; existing?: ProviderConnection; defaultBaseUrl: string } | null>(null)

  // Node creation
  const [showAddNode, setShowAddNode] = useState(false)
  const [compatType, setCompatType] = useState('openai-compatible')
  const [nodeName, setNodeName] = useState('')
  const [nodeUrl, setNodeUrl] = useState('')
  const [nodeApiKey, setNodeApiKey] = useState('')

  // Kilo Code OAuth
  const [showOauth, setShowOauth] = useState(false)
  const [oauthData, setOauthData] = useState<{ verification_url?: string; user_code?: string; device_code?: string } | null>(null)
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'initiating' | 'pending' | 'success' | 'error'>('idle')
  const [oauthEmail, setOauthEmail] = useState('')
  const [oauthError, setOauthError] = useState('')

  // Detail: models / testing
  const [enabledModelIds, setEnabledModelIds] = useState<string[] | null>(null)
  const [thinkingMap, setThinkingMap] = useState<Record<string, boolean>>({})
  const [pricingOverrides, setPricingOverrides] = useState<Record<string, Record<string, number>>>({})
  const [customModelIdInput, setCustomModelIdInput] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [importing, setImporting] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [conns, nodeData, modelData, v1models, logs] = await Promise.all([
        api.get<ProviderConnection[]>('/api/providers'),
        api.get<{ nodes: ProviderNode[] }>('/api/provider-nodes'),
        api.get<{ models: CustomModel[] }>('/api/models/custom'),
        api.get<{ data: ModelEntry[] }>('/v1/models'),
        api.get<{ logs: UsageLog[] }>('/api/usage/logs?perPage=500&page=1'),
      ])
      setConnections(conns ?? [])
      setNodes(nodeData.nodes ?? [])
      setCustomModels(modelData.models ?? [])
      setDetailedLogs(logs.logs ?? [])

      const grouped: Record<string, ModelEntry[]> = {}
      for (const m of v1models.data ?? []) {
        const prov = m.owned_by || 'openai'
        const fullID = m.id || ''
        const slash = fullID.indexOf('/')
        const modelId = slash > 0 ? fullID.slice(slash + 1) : fullID
        grouped[prov] = grouped[prov] ?? []
        if (!grouped[prov].some((x) => x.id === modelId)) {
          grouped[prov].push({ id: modelId, object: 'model', owned_by: prov, created: 0 })
        }
      }
      setProviderModels(grouped)
    } catch (err) {
      console.error('Error loading registry:', err)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const providerMetricsMap = useMemo(() => {
    const map: Record<string, UsageLog[]> = {}
    const connMap: Record<string, string> = {}
    for (const c of connections) {
      if (c.id && c.provider) connMap[c.id] = c.provider.toLowerCase()
    }
    for (const l of detailedLogs) {
      let pId = (l.provider ?? '').toLowerCase()
      if (!pId && l.connectionId && connMap[l.connectionId]) pId = connMap[l.connectionId]
      if (!pId) continue
      map[pId] = map[pId] ?? []
      map[pId].push(l)
    }
    const result: Record<string, ProviderMetrics> = {}
    for (const [pId, logs] of Object.entries(map)) {
      const successLogs = logs.filter((l) => l.status === 'ok')
      const successRate = `${((successLogs.length / logs.length) * 100).toFixed(1)}%`
      let totalLatency = 0
      let latencyCount = 0
      for (const l of logs) {
        if (l.meta) {
          try {
            const meta = JSON.parse(l.meta)
            if (meta.duration_ms) {
              totalLatency += meta.duration_ms
              latencyCount++
            }
          } catch {
            /* ignore */
          }
        }
      }
      const avgLatency = latencyCount > 0 ? `${(totalLatency / latencyCount).toFixed(0)}ms` : '—'
      const recentLogs = logs.slice(0, 10)
      const recentFailures = recentLogs.filter((l) => l.status !== 'ok').length
      const status: ProviderMetrics['status'] = recentLogs.length > 0 && recentFailures / recentLogs.length > 0.5 ? 'Degraded' : 'Healthy'
      result[pId] = { requests: logs.length, successRate, avgLatency, status }
    }
    return result
  }, [detailedLogs, connections])

  const getProviderMetrics = useCallback(
    (providerId: string): ProviderMetrics =>
      providerMetricsMap[(providerId ?? '').toLowerCase()] ?? { requests: 0, successRate: '100%', avgLatency: '—', status: 'Healthy' },
    [providerMetricsMap],
  )

  // Detail loading
  useEffect(() => {
    if (!viewingDetailProvider) return
    const providerId = viewingDetailProvider.id
    api
      .get<{ ids: string[] | null }>(`/api/models/enabled?providerAlias=${encodeURIComponent(providerId)}`)
      .then((data) => setEnabledModelIds(data.ids ?? null))
      .catch(() => setEnabledModelIds(null))
    api
      .get<{ thinkingMap: Record<string, boolean> }>(`/api/models/thinking?providerAlias=${encodeURIComponent(providerId)}`)
      .then((data) => setThinkingMap(data.thinkingMap ?? {}))
      .catch(() => {})
    api
      .get<{ overrides: Record<string, Record<string, number>> }>(`/api/models/pricing?providerAlias=${encodeURIComponent(providerId)}`)
      .then((data) => setPricingOverrides(data.overrides ?? {}))
      .catch(() => {})
    setTestResult(null)
    const conn = connections.find((c) => c.provider === providerId)
    setModelPrefix(conn?.data?.modelPrefix ?? '')
  }, [viewingDetailProvider, connections])

  // OAuth polling
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    if (oauthStatus === 'pending' && oauthData?.device_code) {
      timer = setInterval(async () => {
        try {
          const data = await api.post<{ status: string; email?: string; error?: string }>('/api/oauth/kilocode/poll', {
            device_code: oauthData.device_code,
          })
          if (data.status === 'success') {
            setOauthStatus('success')
            setOauthEmail(data.email ?? '')
            fetchData()
          } else if (data.status === 'error') {
            setOauthStatus('error')
            setOauthError(data.error ?? 'Authorization rejected or expired')
          }
        } catch (err) {
          console.error(err)
        }
      }, 3000)
    }
    return () => clearInterval(timer)
  }, [oauthStatus, oauthData, fetchData])

  const handleStartOauth = () => {
    setOauthStatus('initiating')
    setShowOauth(true)
    setOauthError('')
    api
      .post<{ verification_url?: string; user_code?: string; device_code?: string }>('/api/oauth/kilocode/initiate')
      .then((data) => {
        setOauthData(data)
        setOauthStatus('pending')
      })
      .catch(() => {
        setOauthStatus('error')
        setOauthError('Device flow initialization error')
      })
  }

  const handleCreateNode = async () => {
    if (!nodeName.trim() || !nodeUrl.trim()) return
    const id = `${compatType}-${nodeName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
    try {
      await api.post('/api/provider-nodes', {
        id,
        type: compatType,
        name: nodeName,
        data: { baseUrl: nodeUrl.trim(), ...(nodeApiKey.trim() ? { apiKey: nodeApiKey.trim() } : {}) },
      })
      if (nodeApiKey.trim()) {
        await api.post('/api/providers', {
          id: `${id}-conn-${Date.now()}`,
          provider: id,
          authType: 'apikey',
          name: 'Primary Key',
          email: '',
          priority: 1,
          isActive: true,
          data: { apiKey: nodeApiKey.trim(), baseUrl: nodeUrl.trim(), headers: {} },
        })
      }
      setNodeName('')
      setNodeUrl('')
      setNodeApiKey('')
      setShowAddNode(false)
      await fetchData()
      notify('Provider node created', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Error creating node', 'error')
    }
  }

  const handleDeleteNode = async (id: string) => {
    if (!confirm('Delete this provider node and all its keys?')) return
    try {
      await api.del(`/api/provider-nodes/${id}`)
      setViewingDetailProvider(null)
      await fetchData()
      notify('Provider node deleted', 'info')
    } catch {
      notify('Failed to delete node', 'error')
    }
  }

  const handleRemoveConnection = async (providerId: string) => {
    if (!confirm(`Remove the connection for ${providerId}?`)) return
    try {
      const conn = connections.find((c) => c.provider === providerId)
      if (conn) await api.del(`/api/providers/${conn.id}`)
      if (viewingDetailProvider?.id === providerId) setViewingDetailProvider(null)
      await fetchData()
      notify(`Provider ${providerId} disconnected`, 'info')
    } catch {
      notify('Failed to remove provider connection', 'error')
    }
  }

  const handleTestConnection = async () => {
    if (!viewingDetailProvider) return
    const conn = connections.find((c) => c.provider === viewingDetailProvider.id)
    if (!conn) {
      setTestResult({ ok: false, message: 'No active credentials to test — save a key first.' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const data = await api.post<{ success?: boolean; latencyMs?: number; error?: string; message?: string }>(
        `/api/providers/${conn.id}/test`,
      )
      setTestResult({
        ok: Boolean(data.success),
        message: data.success ? `Connection OK${data.latencyMs ? ` — ${data.latencyMs}ms` : ''}` : data.error ?? data.message ?? 'Test failed',
      })
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  const handleSavePrefix = async () => {
    if (!viewingDetailProvider) return
    const conn = connections.find((c) => c.provider === viewingDetailProvider.id)
    if (!conn) return
    try {
      await api.patch(`/api/providers/${conn.id}`, { data: { ...(conn.data ?? {}), modelPrefix } })
      await fetchData()
      notify('Model prefix saved', 'success')
    } catch {
      notify('Failed to save model prefix', 'error')
    }
  }

  const handleImportModels = async () => {
    if (!viewingDetailProvider) return
    const providerId = viewingDetailProvider.id
    const conn = connections.find((c) => c.provider === providerId)
    if (!conn) return
    setImporting(true)
    try {
      const data = await api.get<{ models: Array<{ id: string; name?: string }> }>(`/api/providers/${conn.id}/models`)
      const existing = new Set(customModels.filter((m) => m.providerAlias === providerId).map((m) => m.id))
      for (const m of data.models ?? []) {
        if (!existing.has(m.id)) {
          await api.post('/api/models/custom', { providerAlias: providerId, id: m.id, type: 'llm', name: m.name || m.id })
        }
      }
      await fetchData()
      notify('Models imported from upstream', 'success')
    } catch {
      notify('Failed to import models', 'error')
    } finally {
      setImporting(false)
    }
  }

  const handleSetEnabledModels = async (ids: string[]) => {
    if (!viewingDetailProvider) return
    try {
      await api.post('/api/models/enabled', { providerAlias: viewingDetailProvider.id, ids })
      const data = await api.get<{ ids: string[] | null }>(`/api/models/enabled?providerAlias=${encodeURIComponent(viewingDetailProvider.id)}`)
      setEnabledModelIds(data.ids ?? null)
      notify('Model list updated', 'success')
    } catch {
      notify('Failed to update model list', 'error')
    }
  }

  const isModelEnabled = (modelId: string) => enabledModelIds === null || enabledModelIds.includes(modelId)

  const handleAddCustomModel = async () => {
    if (!customModelIdInput.trim() || !viewingDetailProvider) return
    try {
      await api.post('/api/models/custom', {
        providerAlias: viewingDetailProvider.id,
        id: customModelIdInput.trim(),
        type: 'llm',
        name: customModelIdInput.trim(),
      })
      setCustomModelIdInput('')
      await fetchData()
      notify('Custom model added', 'success')
    } catch {
      notify('Failed to add custom model', 'error')
    }
  }

  const handleDeleteCustomModel = async (modelId: string) => {
    if (!viewingDetailProvider || !confirm(`Delete custom model ${modelId}?`)) return
    try {
      await api.del(`/api/models/custom?providerAlias=${encodeURIComponent(viewingDetailProvider.id)}&id=${encodeURIComponent(modelId)}`)
      await fetchData()
      notify('Custom model deleted', 'info')
    } catch {
      notify('Failed to delete custom model', 'error')
    }
  }

  const handleToggleThinkingMode = async (modelId: string) => {
    if (!viewingDetailProvider) return
    const nextState = !thinkingMap[modelId]
    setThinkingMap({ ...thinkingMap, [modelId]: nextState })
    try {
      await api.post('/api/models/thinking', { providerAlias: viewingDetailProvider.id, modelId, enabled: nextState })
      notify(`Thinking mode ${nextState ? 'enabled' : 'disabled'} for ${modelId}`, 'success')
    } catch {
      notify('Failed to save thinking mode setting', 'error')
    }
  }

  /* ------------------------------ Provider list ----------------------------- */

  const allProviderEntries = useMemo(() => {
    const entries = [
      ...CORE_PROVIDERS.map((p) => ({ id: p.id, name: p.name, type: p.type, desc: p.desc, isNode: false })),
      ...nodes.map((n) => ({ id: n.id, name: n.name, type: n.type, desc: n.data?.baseUrl ?? '', isNode: true })),
    ]
    const q = providerSearchQuery.toLowerCase()
    return q ? entries.filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)) : entries
  }, [nodes, providerSearchQuery])

  const getConnectionFor = (providerId: string) => connections.find((c) => c.provider === providerId)

  if (viewingDetailProvider) {
    const provider = viewingDetailProvider
    const models = providerModels[provider.id] ?? []
    const customs = customModels.filter((m) => m.providerAlias === provider.id)
    return (
      <PageContainer>
        <button
          onClick={() => setViewingDetailProvider(null)}
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-text"
        >
          <ArrowLeft size={14} /> All providers
        </button>

        <PageHeader
          title={provider.name}
          description={provider.id}
          actions={
            <div className="flex gap-2">
              <Button size="sm" loading={testing} onClick={handleTestConnection}>
                <Zap size={13} /> Test connection
              </Button>
              <Button size="sm" onClick={() => setCredEditor({ providerId: provider.id, title: 'Edit credentials', existing: getConnectionFor(provider.id), defaultBaseUrl: provider.baseUrl })}>
                <Pencil size={13} /> Edit credentials
              </Button>
            </div>
          }
        />

        {testResult && (
          <div
            className={cn(
              'mb-4 rounded-md border px-3 py-2.5 text-[13px]',
              testResult.ok ? 'border-transparent bg-success-subtle text-success' : 'bg-danger-subtle text-danger border-transparent',
            )}
          >
            {testResult.message}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Connection</h3>
              {(() => {
                const conn = getConnectionFor(provider.id)
                return conn ? <Badge tone="success">Active</Badge> : <Badge>Not configured</Badge>
              })()}
            </div>
            <div className="flex flex-col gap-3">
              <Field label="Model prefix override" hint="Rewrites the model IDs exposed on /v1/models for this provider.">
                <div className="flex gap-2">
                  <Input value={modelPrefix} onChange={(e) => setModelPrefix(e.target.value)} placeholder="provider/model" className="font-mono text-xs" />
                  <Button size="md" onClick={handleSavePrefix}>
                    Save
                  </Button>
                </div>
              </Field>
              <Button variant="ghost" className="justify-start text-danger hover:bg-danger-subtle hover:text-danger" onClick={() => handleRemoveConnection(provider.id)}>
                <Trash2 size={13} /> Remove connection
              </Button>
              {provider.isNode && (
                <Button variant="ghost" className="justify-start text-danger hover:bg-danger-subtle hover:text-danger" onClick={() => handleDeleteNode(provider.id)}>
                  <Trash2 size={13} /> Delete provider node
                </Button>
              )}
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold">Models</h3>
            <div className="mb-3 flex gap-2">
              <Input
                placeholder="Add model ID manually…"
                value={customModelIdInput}
                onChange={(e) => setCustomModelIdInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCustomModel()}
                className="font-mono text-xs"
              />
              <Button size="md" onClick={handleAddCustomModel}>
                Add
              </Button>
            </div>
            <div className="mb-3 flex gap-2">
              <Button size="sm" loading={importing} onClick={handleImportModels}>
                <RefreshCw size={12} /> Import from upstream
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleSetEnabledModels(models.filter((m) => isModelEnabled(m.id)).map((m) => m.id))}>
                Save current selection
              </Button>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border border-border">
              {[...customs.map((c) => ({ id: c.id, custom: true as const })), ...models.map((m) => ({ id: m.id, custom: false as const }))]
                .filter((entry, i, arr) => arr.findIndex((x) => x.id === entry.id) === i)
                .map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 last:border-b-0">
                    <Toggle checked={isModelEnabled(entry.id)} onChange={() => handleSetEnabledModels(isModelEnabled(entry.id) ? (enabledModelIds ?? []).filter((x) => x !== entry.id) : [...(enabledModelIds ?? models.map((m) => m.id)), entry.id])} />
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{entry.id}</code>
                    <button
                      onClick={() => handleToggleThinkingMode(entry.id)}
                      className={cn('transition-colors', thinkingMap[entry.id] ? 'text-accent' : 'text-subtle hover:text-text')}
                      aria-label={`Toggle thinking mode for ${entry.id}`}
                      title="Thinking mode"
                    >
                      <Brain size={12} />
                    </button>
                    {entry.custom && (
                      <button onClick={() => handleDeleteCustomModel(entry.id)} className="text-subtle hover:text-danger" aria-label={`Delete ${entry.id}`}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
            </div>
            <div className="mt-2 text-[11px] text-subtle">Thinking mode marks models whose reasoning stream should render as thinking.</div>
          </Card>

          {Object.keys(pricingOverrides).length > 0 && (
            <Card className="lg:col-span-2">
              <h3 className="mb-3 text-sm font-semibold">Pricing overrides</h3>
              <div className="tnum grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(pricingOverrides).map(([model, prices]) => (
                  <div key={model} className="rounded-md bg-surface-2 px-3 py-2">
                    <code className="block truncate font-mono text-[11px]">{model}</code>
                    <span className="text-muted">
                      in {prices.Input ?? prices.input ?? 0} / out {prices.Output ?? prices.output ?? 0} / cached {prices.Cached ?? prices.cached ?? 0}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {credEditor && (
          <CredentialEditor
            title={credEditor.title}
            providerId={credEditor.providerId}
            existing={credEditor.existing}
            defaultBaseUrl={credEditor.defaultBaseUrl}
            onDone={() => {
              setCredEditor(null)
              fetchData()
            }}
            onCancel={() => setCredEditor(null)}
          />
        )}
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Providers"
        description="Upstream connections, credentials, and model registries. Requests are forwarded to the active provider accounts."
        actions={
          <Button size="md" onClick={() => setShowAddNode(true)}>
            <Plus size={14} /> Add node
          </Button>
        }
      />

      <div className="mb-4">
        <Input placeholder="Search providers…" value={providerSearchQuery} onChange={(e) => setProviderSearchQuery(e.target.value)} className="max-w-sm" />
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
        {allProviderEntries.map((p) => {
          const conn = getConnectionFor(p.id)
          const metrics = getProviderMetrics(p.id)
          const connected = Boolean(conn)
          return (
            <Card
              key={p.id}
              interactive
              onClick={() => setViewingDetailProvider({ id: p.id, name: p.name, type: p.type, baseUrl: p.isNode ? nodes.find((n) => n.id === p.id)?.data?.baseUrl ?? '' : PROVIDER_URLS[p.id] ?? '', isNode: p.isNode })}
            >
              <div className="flex items-start gap-3">
                <ProviderIcon id={p.id} name={p.name} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-text">{p.name}</span>
                    {p.type === 'oauth' && <Badge tone="accent">OAuth</Badge>}
                    {p.isNode && <Badge>Node</Badge>}
                  </div>
                  <div className="truncate text-[11px] text-muted">{p.desc}</div>
                  <div className="tnum mt-2 flex items-center gap-3 text-[11px]">
                    <span className={cn('inline-flex items-center gap-1', connected ? 'text-success' : 'text-subtle')}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-success' : 'bg-subtle')} />
                      {connected ? 'Connected' : 'Not connected'}
                    </span>
                    {connected && <span className="text-subtle">{metrics.successRate} ok</span>}
                    {connected && <span className="text-subtle">{metrics.avgLatency}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {p.type === 'oauth' && p.id === 'kilocode' && !connected ? (
                    <Button size="sm" variant="primary" onClick={handleStartOauth}>
                      <KeyRound size={12} /> Authorize
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() =>
                        setCredEditor({
                          providerId: p.id,
                          title: connected ? 'Edit credentials' : 'Add credentials',
                          existing: conn,
                          defaultBaseUrl: p.isNode ? nodes.find((n) => n.id === p.id)?.data?.baseUrl ?? '' : PROVIDER_URLS[p.id] ?? '',
                        })
                      }
                    >
                      {connected ? 'Edit' : 'Connect'}
                    </Button>
                  )}
                  {connected && (
                    <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-subtle hover:text-danger" onClick={() => handleRemoveConnection(p.id)}>
                      <Trash2 size={12} />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* OAuth modal */}
      <Modal open={showOauth} onClose={() => setShowOauth(false)} title="Kilo Code authorization" width="max-w-md">
        {oauthStatus === 'pending' && oauthData && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <Spinner size={20} />
            <p className="text-[13px] text-muted">
              Open{' '}
              <a href={oauthData.verification_url} target="_blank" rel="noreferrer" className="text-accent underline">
                {oauthData.verification_url}
              </a>{' '}
              and enter the code:
            </p>
            <code className="rounded-md border border-border bg-surface-2 px-4 py-2 font-mono text-lg font-semibold tracking-widest">{oauthData.user_code}</code>
            <p className="text-[11px] text-subtle">Waiting for authorization…</p>
          </div>
        )}
        {oauthStatus === 'success' && (
          <p className="py-4 text-center text-[13px] text-success">Authorized{oauthEmail ? ` as ${oauthEmail}` : ''}.</p>
        )}
        {oauthStatus === 'error' && <p className="py-4 text-center text-[13px] text-danger">{oauthError}</p>}
      </Modal>

      {/* Add node modal */}
      <Modal
        open={showAddNode}
        onClose={() => setShowAddNode(false)}
        title="Add provider node"
        subtitle="Register an OpenAI- or Anthropic-compatible endpoint."
        footer={
          <>
            <Button onClick={() => setShowAddNode(false)}>Cancel</Button>
            <Button variant="primary" disabled={!nodeName.trim() || !nodeUrl.trim()} onClick={handleCreateNode}>
              Create node
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Compatibility">
            <Select value={compatType} onChange={(e) => setCompatType(e.target.value)}>
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="anthropic-compatible">Anthropic-compatible</option>
            </Select>
          </Field>
          <Field label="Name">
            <Input value={nodeName} onChange={(e) => setNodeName(e.target.value)} placeholder="e.g. My Proxy" />
          </Field>
          <Field label="Base URL">
            <Input value={nodeUrl} onChange={(e) => setNodeUrl(e.target.value)} placeholder="https://api.example.com/v1" />
          </Field>
          <Field label="API key (optional)">
            <Input type="password" value={nodeApiKey} onChange={(e) => setNodeApiKey(e.target.value)} placeholder="sk-…" />
          </Field>
        </div>
      </Modal>

      {credEditor && (
        <CredentialEditor
          title={credEditor.title}
          providerId={credEditor.providerId}
          existing={credEditor.existing}
          defaultBaseUrl={credEditor.defaultBaseUrl}
          onDone={() => {
            setCredEditor(null)
            fetchData()
          }}
          onCancel={() => setCredEditor(null)}
        />
      )}
    </PageContainer>
  )
}
