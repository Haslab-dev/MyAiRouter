import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Brain, ChevronDown, ChevronRight, Eye, EyeOff, KeyRound, Pencil, Plus, RefreshCw, Trash2, Zap } from 'lucide-react'
import { api } from '@/lib/api'
import { useSnackbar } from '@/stores/snackbar'
import ProviderIcon from '@/components/ProviderIcon'
import { Badge, Button, Card, Field, Input, Modal, PageContainer, PageHeader, Select, Spinner, Toggle } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { ModelEntry, ProviderConnection, ProxyRoute } from '@/lib/types'

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

const OAUTH_PROVIDERS = [
  { id: 'xai', name: 'xAI (Grok)', desc: 'Sign in via auth.x.ai' },
  { id: 'grok-cli', name: 'Grok CLI (Grok Build)', desc: 'Subscription login' },
  { id: 'kimi', name: 'Kimi', desc: 'Sign in via kimi.com' },
  { id: 'copilot', name: 'GitHub Copilot', desc: 'Sign in via github.com' },
  { id: 'qoder', name: 'Qoder', desc: 'Sign in via qoder.com' },
  { id: 'codebuddy', name: 'CodeBuddy', desc: 'QR login (international)' },
  { id: 'codebuddy-cn', name: 'CodeBuddy CN', desc: 'QR login (China)' },
  { id: 'cline', name: 'Cline', desc: 'Browser sign in' },
  { id: 'clinepass', name: 'ClinePass', desc: 'Browser sign in' },
  { id: 'kilocode', name: 'Kilo Code', desc: 'Authorization code sign in' },
] as const

const PROVIDER_URLS: Record<string, string> = {
  xai: 'https://api.x.ai/v1',
  'grok-cli': 'https://cli-chat-proxy.grok.com/v1',
  kimi: 'https://api.kimi.com/coding',
  copilot: 'https://api.githubcopilot.com',
  qoder: 'https://api3.qoder.sh',
  codebuddy: 'https://www.codebuddy.ai/v2',
  'codebuddy-cn': 'https://copilot.tencent.com/v2',
  cline: 'https://api.cline.bot/api/v1',
  clinepass: 'https://api.cline.bot/api/v1',
  kilocode: 'https://api.kilo.ai/api/openrouter',
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

function shortProviderId(id: string): string {
  return id.replace(/^(openai|anthropic)-compatible-/, '')
}

function CredentialEditor({ title, providerId, existing, defaultBaseUrl, onDone, onCancel }: CredentialEditorProps) {
  const notify = useSnackbar((s) => s.notify)
  const [credName, setCredName] = useState(existing?.name ?? '')
  // Never prefill with the masked placeholder from GET /api/providers; leave
  // blank on edit so updating other fields preserves the stored key.
  const [credKey, setCredKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [credPriority, setCredPriority] = useState(existing?.priority ?? 1)
  const [proxyRouteId, setProxyRouteId] = useState<string>(existing?.data?.proxyRouteId ?? '')
  const [proxyRoutes, setProxyRoutes] = useState<ProxyRoute[]>([])
  const [customHeaders, setCustomHeaders] = useState<HeaderRow[]>(() => {
    const hdrs = existing?.data?.headers ?? {}
    const list = Object.keys(hdrs).map((k) => ({ key: k, value: String(hdrs[k]) }))
    return list.length > 0 ? list : [{ key: '', value: '' }]
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .get<{ routes: ProxyRoute[] }>('/api/proxies')
      .then((d) => setProxyRoutes((d.routes ?? []).filter((r) => r.isEnabled)))
      .catch(() => {})
  }, [])

  const save = async () => {
    const trimmedKey = credKey.trim()
    const hasExistingKey = Boolean(existing?.data?.apiKey)
    if (!trimmedKey && !hasExistingKey) {
      notify('API key is required', 'error')
      return
    }
    const headersMap: Record<string, string> = {}
    for (const h of customHeaders) {
      if (h.key.trim() && h.value.trim()) headersMap[h.key.trim()] = h.value.trim()
    }
    const dataPayload: Record<string, unknown> = {
      baseUrl: existing?.data?.baseUrl || defaultBaseUrl,
      headers: headersMap,
      proxyRouteId: proxyRouteId || '',
    }
    if (trimmedKey) {
      dataPayload.apiKey = trimmedKey
    }
    const payload = existing
      ? {
          name: credName || 'Default Key',
          priority: credPriority || 1,
          data: dataPayload,
        }
      : {
          id: `${providerId}-conn-${Date.now()}`,
          provider: providerId,
          authType: 'apikey',
          name: credName || 'Default Key',
          email: '',
          priority: credPriority || 1,
          isActive: true,
          data: dataPayload,
        }
    setSaving(true)
    try {
      if (existing) {
        await api.patch(`/api/providers/${existing.id}`, payload)
      } else {
        await api.post('/api/providers', payload)
      }
      notify(existing ? 'Credentials updated' : 'Provider connected', 'success')
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
      subtitle={`Provider: ${shortProviderId(providerId)}`}
      footer={
        <>
          <Button size="md" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="md" variant="primary" loading={saving} onClick={save}>
            {existing ? 'Save changes' : 'Connect provider'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="API key" hint={existing?.data?.apiKey ? `Current key: ${existing.data.apiKey} — leave blank to keep it.` : 'Paste the API key from your provider dashboard.'}>
          <div className="flex gap-2">
            <Input
              type={showKey ? 'text' : 'password'}
              value={credKey}
              onChange={(e) => setCredKey(e.target.value)}
              placeholder={existing?.data?.apiKey ? 'Leave blank to keep current key' : 'sk-…'}
              className="font-mono text-xs"
            />
            <Button
              size="md"
              variant="secondary"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
            </Button>
          </div>
        </Field>

        <Field label="Name (optional)" hint="A friendly label to help you recognize this key.">
          <Input value={credName} onChange={(e) => setCredName(e.target.value)} placeholder="e.g. Personal Key" />
        </Field>

        <div className="border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Advanced options (priority, proxy, headers)
          </button>

          {showAdvanced && (
            <div className="mt-3 flex flex-col gap-3">
              <Field label="Priority" hint="Lower number = tried first if you have multiple keys.">
                <Input type="number" min={1} value={credPriority} onChange={(e) => setCredPriority(parseInt(e.target.value, 10) || 1)} />
              </Field>
              <Field label="Proxy route" hint="Optional outbound proxy to mask your IP.">
                <Select value={proxyRouteId} onChange={(e) => setProxyRouteId(e.target.value)}>
                  <option value="">Direct (no proxy)</option>
                  {proxyRoutes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} — {r.scheme}://{r.host}:{r.port}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted">Custom headers</span>
                  <Button size="sm" variant="ghost" onClick={() => setCustomHeaders([...customHeaders, { key: '', value: '' }])}>
                    <Plus size={12} /> Add header
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  {customHeaders.map((h, i) => (
                    <div key={i} className="flex gap-2">
                      <Input placeholder="Header" value={h.key} onChange={(e) => setCustomHeaders(customHeaders.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                      <Input placeholder="Value" value={h.value} onChange={(e) => setCustomHeaders(customHeaders.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                      <Button size="md" variant="ghost" aria-label="Remove header" onClick={() => setCustomHeaders(customHeaders.filter((_, j) => j !== i))}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

type ProviderFilter = 'all' | 'connected' | 'unconnected'

export default function ProvidersPage() {
  const notify = useSnackbar((s) => s.notify)
  const [connections, setConnections] = useState<ProviderConnection[]>([])
  const [nodes, setNodes] = useState<ProviderNode[]>([])
  const [customModels, setCustomModels] = useState<CustomModel[]>([])
  const [providerModels, setProviderModels] = useState<Record<string, ModelEntry[]>>({})
  const [detailedLogs, setDetailedLogs] = useState<UsageLog[]>([])
  const [providerSearchQuery, setProviderSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState<ProviderFilter>('all')
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [viewingDetailProvider, setViewingDetailProvider] = useState<{ id: string; name: string; type: string; baseUrl: string; isNode: boolean } | null>(null)
  const [modelPrefix, setModelPrefix] = useState('')
  const [showDetailAdvanced, setShowDetailAdvanced] = useState(false)

  const [credEditor, setCredEditor] = useState<{ providerId: string; title: string; existing?: ProviderConnection; defaultBaseUrl: string } | null>(null)

  // Node creation
  const [showAddNode, setShowAddNode] = useState(false)
  const [compatType, setCompatType] = useState('openai-compatible')
  const [nodeName, setNodeName] = useState('')
  const [nodeUrl, setNodeUrl] = useState('')
  const [nodeApiKey, setNodeApiKey] = useState('')

  // OAuth (any provider)
  const [oauthProvider, setOauthProvider] = useState<string>('')
  const [showOauth, setShowOauth] = useState(false)
  const [oauthData, setOauthData] = useState<{ verification_uri?: string; verification_url?: string; user_code?: string; device_code?: string } | null>(null)
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'initiating' | 'pending' | 'success' | 'error'>('idle')
  const [oauthEmail, setOauthEmail] = useState('')
  const [oauthError, setOauthError] = useState('')

  // Detail: models / testing
  const [enabledModelIds, setEnabledModelIds] = useState<string[] | null>(null)
  const [thinkingMap, setThinkingMap] = useState<Record<string, boolean>>({})
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
        api.get<{ data: ModelEntry[] }>('/api/models?all=true'),
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
    setTestResult(null)
    setShowDetailAdvanced(false)
    const conn = connections.find((c) => c.provider === providerId)
    setModelPrefix(conn?.data?.modelPrefix ?? '')
  }, [viewingDetailProvider, connections])

  // OAuth polling (generic: /api/oauth/{provider}/initiate|poll)
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    if (oauthStatus === 'pending' && oauthProvider) {
      timer = setInterval(async () => {
        try {
          const data = await api.post<{ status: string; email?: string; error?: string }>(`/api/oauth/${oauthProvider}/poll`, {})
          if (data.status === 'success') {
            setOauthStatus('success')
            setOauthEmail(data.email ?? '')
            fetchData()
          } else if (data.status === 'error') {
            setOauthStatus('error')
            setOauthError(data.error ?? 'Authorization rejected or expired')
          } else if (data.status === 'expired') {
            setOauthStatus('error')
            setOauthError('Login expired — initiate again.')
          }
        } catch (err) {
          console.error(err)
        }
      }, 3000)
    }
    return () => clearInterval(timer)
  }, [oauthStatus, oauthProvider, fetchData])

  const handleToggleProvider = async (conn: ProviderConnection, providerName: string) => {
    const nextActive = !conn.isActive
    setTogglingId(conn.id)
    try {
      await api.patch(`/api/providers/${conn.id}`, { isActive: nextActive })
      await fetchData()
      notify(`${providerName} ${nextActive ? 'enabled' : 'disabled'}`, nextActive ? 'success' : 'info')
    } catch {
      notify(`Failed to ${nextActive ? 'enable' : 'disable'} ${providerName}`, 'error')
    } finally {
      setTogglingId(null)
    }
  }

  const handleStartOauth = (providerId: string) => {
    const initUrl = providerId === 'kilocode' ? '/api/oauth/kilocode/initiate' : `/api/oauth/${providerId}/initiate`
    setOauthProvider(providerId)
    setOauthStatus('initiating')
    setShowOauth(true)
    setOauthError('')
    api
      .post<{ verification_uri?: string; verification_url?: string; user_code?: string; device_code?: string }>(initUrl)
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
    const slug = nodeName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const id = slug || `${compatType}-${Date.now()}`
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
      notify('Custom endpoint added', 'success')
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Error creating endpoint', 'error')
    }
  }

  const handleDeleteNode = async (id: string) => {
    if (!confirm('Delete this custom provider and all its keys?')) return
    try {
      await api.del(`/api/provider-nodes/${id}`)
      setViewingDetailProvider(null)
      await fetchData()
      notify('Custom provider deleted', 'info')
    } catch {
      notify('Failed to delete custom provider', 'error')
    }
  }

  const handleRemoveConnection = async (providerId: string) => {
    if (!confirm(`Disconnect ${providerId} and remove its saved API key?`)) return
    try {
      const conn = connections.find((c) => c.provider === providerId)
      if (conn) await api.del(`/api/providers/${conn.id}`)
      if (viewingDetailProvider?.id === providerId) setViewingDetailProvider(null)
      await fetchData()
      notify(`${providerId} disconnected`, 'info')
    } catch {
      notify('Failed to disconnect provider', 'error')
    }
  }

  const handleTestConnection = async () => {
    if (!viewingDetailProvider) return
    const conn = connections.find((c) => c.provider === viewingDetailProvider.id)
    if (!conn) {
      setTestResult({ ok: false, message: 'No credentials saved yet — add an API key first.' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const data = await api.post<{ valid?: boolean; success?: boolean; latencyMs?: number; error?: string; message?: string; lastError?: string }>(
        `/api/providers/${conn.id}/test`,
      )
      const isValid = Boolean(data.valid ?? data.success)
      setTestResult({
        ok: isValid,
        message: isValid
          ? `Connection OK${data.latencyMs ? ` — ${data.latencyMs}ms` : ''}`
          : data.error ?? data.lastError ?? data.message ?? 'Test failed',
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
      await api.patch(`/api/providers/${conn.id}`, { data: { modelPrefix } })
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
      notify('Models imported', 'success')
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
      notify('Model added', 'success')
    } catch {
      notify('Failed to add model', 'error')
    }
  }

  const handleDeleteCustomModel = async (modelId: string) => {
    if (!viewingDetailProvider || !confirm(`Remove model ${modelId}?`)) return
    try {
      await api.del(`/api/models/custom?providerAlias=${encodeURIComponent(viewingDetailProvider.id)}&id=${encodeURIComponent(modelId)}`)
      await fetchData()
      notify('Model removed', 'info')
    } catch {
      notify('Failed to remove model', 'error')
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

  const getConnectionFor = useCallback(
    (providerId: string) => connections.find((c) => c.provider === providerId),
    [connections],
  )

  const allProviderEntries = useMemo(() => {
    const entries = [
      ...OAUTH_PROVIDERS.map((p) => ({ id: p.id, name: p.name, type: 'oauth', desc: p.desc, isNode: false })),
      ...CORE_PROVIDERS.map((p) => ({ id: p.id, name: p.name, type: p.type, desc: p.desc, isNode: false })),
      ...nodes.map((n) => ({ id: n.id, name: n.name, type: n.type, desc: n.data?.baseUrl ?? '', isNode: true })),
    ]
    const q = providerSearchQuery.toLowerCase()
    return entries.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q) && !e.id.toLowerCase().includes(q)) return false
      const hasConn = Boolean(getConnectionFor(e.id))
      if (filterMode === 'connected') return hasConn
      if (filterMode === 'unconnected') return !hasConn
      return true
    })
  }, [nodes, providerSearchQuery, filterMode, getConnectionFor])

  const providerGroups = useMemo(() => {
    const custom = allProviderEntries.filter((e) => e.isNode)
    const connect = allProviderEntries.filter((e) => e.type !== 'oauth' && !e.isNode)
    const oauth = allProviderEntries.filter((e) => e.type === 'oauth')
    return [
      { key: 'custom', title: 'Your Custom Endpoints', hint: 'OpenAI- or Anthropic-compatible servers you added.', entries: custom },
      { key: 'connect', title: 'API Key Providers', hint: 'Paste an API key to start using models from these providers.', entries: connect },
      { key: 'oauth', title: 'Subscription Logins (OAuth)', hint: 'Sign in with an existing account — no API key needed.', entries: oauth },
    ].filter((g) => g.entries.length > 0)
  }, [allProviderEntries])

  if (viewingDetailProvider) {
    const provider = viewingDetailProvider
    const conn = getConnectionFor(provider.id)
    const models = providerModels[provider.id] ?? []
    const customs = customModels.filter((m) => m.providerAlias === provider.id)
    const allModels = [...customs.map((c) => ({ id: c.id, custom: true as const })), ...models.map((m) => ({ id: m.id, custom: false as const }))]
      .filter((entry, i, arr) => arr.findIndex((x) => x.id === entry.id) === i)

    return (
      <PageContainer>
        <button
          type="button"
          onClick={() => setViewingDetailProvider(null)}
          className="mb-4 inline-flex items-center gap-2 rounded-md px-1 py-1 text-sm font-medium text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft size={16} /> Back to all providers
        </button>

        <PageHeader
          title={
            <span className="inline-flex items-center gap-3">
              <ProviderIcon id={provider.id} name={provider.name} size={32} />
              <span>{provider.name}</span>
              {conn ? (
                conn.isActive ? <Badge tone="success">Enabled</Badge> : <Badge tone="warning">Disabled</Badge>
              ) : (
                <Badge>Not connected</Badge>
              )}
            </span>
          }
          description={shortProviderId(provider.id)}
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {conn && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5">
                  <span className="text-xs font-medium text-muted">{conn.isActive ? 'Enabled' : 'Disabled'}</span>
                  <Toggle
                    checked={conn.isActive}
                    disabled={togglingId === conn.id}
                    label={`Enable or disable ${provider.name}`}
                    onChange={() => handleToggleProvider(conn, provider.name)}
                  />
                </div>
              )}
              <Button size="md" loading={testing} onClick={handleTestConnection}>
                <Zap size={15} /> Test connection
              </Button>
              <Button
                size="md"
                variant="primary"
                onClick={() => setCredEditor({ providerId: provider.id, title: conn ? 'Edit API key & settings' : 'Connect provider', existing: conn, defaultBaseUrl: provider.baseUrl })}
              >
                <Pencil size={15} /> {conn ? 'Edit API key' : 'Add API key'}
              </Button>
            </div>
          }
        />

        {testResult && (
          <div
            role="status"
            className={cn(
              'mb-5 rounded-lg border px-4 py-3 text-sm font-medium',
              testResult.ok ? 'border-transparent bg-success-subtle text-success' : 'border-transparent bg-danger-subtle text-danger',
            )}
          >
            {testResult.message}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="flex flex-col gap-4">
            <h3 className="text-base font-semibold text-text">Connection Details</h3>
            <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-bg p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted">Status</span>
                <span className="font-medium text-text">
                  {conn ? (conn.isActive ? 'Active & ready' : 'Paused (disabled)') : 'Not connected'}
                </span>
              </div>
              {conn?.name && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">Key label</span>
                  <span className="font-medium text-text">{conn.name}</span>
                </div>
              )}
              {provider.baseUrl && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">Endpoint</span>
                  <code className="max-w-[65%] truncate font-mono text-xs text-text">{provider.baseUrl}</code>
                </div>
              )}
            </div>

            <div className="border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setShowDetailAdvanced(!showDetailAdvanced)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {showDetailAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Advanced & danger zone
              </button>

              {showDetailAdvanced && (
                <div className="mt-4 flex flex-col gap-4">
                  <Field label="Model prefix override" hint="Optional: rewrites the prefix shown in /v1/models.">
                    <div className="flex gap-2">
                      <Input value={modelPrefix} onChange={(e) => setModelPrefix(e.target.value)} placeholder="provider/" className="font-mono text-xs" />
                      <Button size="md" onClick={handleSavePrefix}>
                        Save
                      </Button>
                    </div>
                  </Field>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {conn && (
                      <Button size="md" variant="danger" onClick={() => handleRemoveConnection(provider.id)}>
                        <Trash2 size={14} /> Disconnect provider
                      </Button>
                    )}
                    {provider.isNode && (
                      <Button size="md" variant="danger" onClick={() => handleDeleteNode(provider.id)}>
                        <Trash2 size={14} /> Delete custom endpoint
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-text">Available Models</h3>
              <div className="flex items-center gap-2">
                <Button size="sm" loading={importing} onClick={handleImportModels}>
                  <RefreshCw size={13} /> Import from upstream
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="Add model ID (e.g. deepseek-chat)…"
                value={customModelIdInput}
                onChange={(e) => setCustomModelIdInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCustomModel()}
                className="font-mono text-xs"
              />
              <Button size="md" variant="primary" onClick={handleAddCustomModel}>
                Add
              </Button>
            </div>

            <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-bg">
              {allModels.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-subtle">
                  No models listed yet. Click "Import from upstream" or add one above.
                </div>
              ) : (
                allModels.map((entry) => {
                  const enabled = isModelEnabled(entry.id)
                  return (
                    <div key={entry.id} className="flex items-center gap-3 border-b border-border/60 px-3.5 py-2.5 last:border-b-0">
                      <Toggle
                        checked={enabled}
                        label={`Enable model ${entry.id}`}
                        onChange={() =>
                          handleSetEnabledModels(
                            enabled
                              ? (enabledModelIds ?? []).filter((x) => x !== entry.id)
                              : [...(enabledModelIds ?? models.map((m) => m.id)), entry.id],
                          )
                        }
                      />
                      <code className="min-w-0 flex-1 truncate font-mono text-xs text-text">{entry.id}</code>
                      <button
                        type="button"
                        onClick={() => handleToggleThinkingMode(entry.id)}
                        className={cn(
                          'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                          thinkingMap[entry.id] ? 'bg-accent-subtle text-accent' : 'text-subtle hover:text-text',
                        )}
                        aria-label={`Toggle thinking mode for ${entry.id}`}
                        title="Thinking mode"
                      >
                        <Brain size={15} />
                      </button>
                      {entry.custom && (
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomModel(entry.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-subtle transition-colors hover:bg-danger-subtle hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          aria-label={`Delete model ${entry.id}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
            <div className="text-xs text-subtle">
              Turn models on/off to choose which ones appear in Chat and Routes. Click the brain icon for thinking/reasoning models.
            </div>
          </Card>
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
        description="Connect your AI accounts and turn providers on or off anytime without losing your saved keys."
        actions={
          <Button variant="primary" size="lg" onClick={() => setShowAddNode(true)}>
            <Plus size={16} /> Add custom endpoint
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search providers (e.g. DeepSeek, Qwen, GLM)…"
          value={providerSearchQuery}
          onChange={(e) => setProviderSearchQuery(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface p-1" role="group" aria-label="Filter providers">
          {([
            ['all', 'All'],
            ['connected', 'Connected'],
            ['unconnected', 'Not connected'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilterMode(key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                filterMode === key ? 'bg-accent text-on-accent' : 'text-muted hover:text-text',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {providerGroups.map((group) => (
        <section key={group.key} className="mb-8">
          <div className="mb-3 flex flex-wrap items-baseline gap-2">
            <h2 className="text-base font-semibold text-text">{group.title}</h2>
            <span className="text-xs text-muted">{group.hint}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {group.entries.map((p) => {
              const conn = getConnectionFor(p.id)
              const metrics = getProviderMetrics(p.id)
              const connected = Boolean(conn)
              const isActive = Boolean(conn?.isActive)
              const baseUrl = p.isNode ? nodes.find((n) => n.id === p.id)?.data?.baseUrl ?? '' : PROVIDER_URLS[p.id] ?? ''

              return (
                <Card
                  key={p.id}
                  interactive
                  onClick={() => setViewingDetailProvider({ id: p.id, name: p.name, type: p.type, baseUrl, isNode: p.isNode })}
                  className={cn('flex flex-col justify-between gap-4', connected && !isActive && 'opacity-75')}
                >
                  <div className="flex items-start gap-3.5">
                    <ProviderIcon id={p.id} name={p.name} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-text">{p.name}</span>
                        {p.type === 'oauth' && <Badge tone="accent">OAuth</Badge>}
                        {p.isNode && <Badge>Custom</Badge>}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted">{p.desc}</p>
                    </div>
                    {connected && conn && (
                      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Toggle
                          checked={isActive}
                          disabled={togglingId === conn.id}
                          label={`Enable or disable ${p.name}`}
                          onChange={() => handleToggleProvider(conn, p.name)}
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                    <div className="tnum flex items-center gap-2 text-xs">
                      {connected ? (
                        isActive ? (
                          <Badge tone="success">Active</Badge>
                        ) : (
                          <Badge tone="warning">Disabled</Badge>
                        )
                      ) : (
                        <Badge>Not connected</Badge>
                      )}
                      {connected && metrics.requests > 0 && (
                        <span className="text-subtle">{metrics.successRate} ok</span>
                      )}
                    </div>

                    <div onClick={(e) => e.stopPropagation()}>
                      {p.type === 'oauth' && !connected ? (
                        <Button size="md" variant="primary" onClick={() => handleStartOauth(p.id)}>
                          <KeyRound size={14} /> Sign in
                        </Button>
                      ) : connected ? (
                        <Button
                          size="md"
                          variant="secondary"
                          onClick={() => setViewingDetailProvider({ id: p.id, name: p.name, type: p.type, baseUrl, isNode: p.isNode })}
                        >
                          Configure
                        </Button>
                      ) : (
                        <Button
                          size="md"
                          variant="primary"
                          onClick={() =>
                            setCredEditor({
                              providerId: p.id,
                              title: `Connect ${p.name}`,
                              defaultBaseUrl: baseUrl,
                            })
                          }
                        >
                          Connect
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </section>
      ))}

      {/* OAuth modal */}
      <Modal open={showOauth} onClose={() => setShowOauth(false)} title={`${OAUTH_PROVIDERS.find((p) => p.id === oauthProvider)?.name ?? 'Provider'} sign in`} width="max-w-md">
        {oauthStatus === 'initiating' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Spinner size={24} />
            <p className="text-sm text-muted">Requesting login code…</p>
          </div>
        )}
        {oauthStatus === 'pending' && oauthData && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Spinner size={24} />
            <p className="text-sm text-muted">
              Open{' '}
              <a href={oauthData.verification_uri ?? oauthData.verification_url} target="_blank" rel="noreferrer" className="text-accent underline">
                {oauthData.verification_uri ?? oauthData.verification_url}
              </a>
              {oauthData.user_code ? ' and enter this code:' : ' and approve access.'}
            </p>
            {oauthData.user_code && (
              <code className="rounded-lg border border-border bg-surface-2 px-5 py-2.5 font-mono text-xl font-semibold tracking-widest">{oauthData.user_code}</code>
            )}
            <p className="text-xs text-subtle">Waiting for authorization…</p>
          </div>
        )}
        {oauthStatus === 'success' && (
          <p className="py-6 text-center text-sm font-medium text-success">Signed in{oauthEmail ? ` as ${oauthEmail}` : ''}.</p>
        )}
        {oauthStatus === 'error' && <p className="py-6 text-center text-sm text-danger">{oauthError}</p>}
      </Modal>

      {/* Add node modal */}
      <Modal
        open={showAddNode}
        onClose={() => setShowAddNode(false)}
        title="Add custom endpoint"
        subtitle="Connect any OpenAI- or Anthropic-compatible server."
        footer={
          <>
            <Button size="md" onClick={() => setShowAddNode(false)}>
              Cancel
            </Button>
            <Button size="md" variant="primary" disabled={!nodeName.trim() || !nodeUrl.trim()} onClick={handleCreateNode}>
              Add endpoint
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="API format">
            <Select value={compatType} onChange={(e) => setCompatType(e.target.value)}>
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="anthropic-compatible">Anthropic-compatible</option>
            </Select>
          </Field>
          <Field label="Name">
            <Input value={nodeName} onChange={(e) => setNodeName(e.target.value)} placeholder="e.g. My Local Server" />
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
