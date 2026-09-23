import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Globe, Plus, ShieldCheck, Trash2, Zap } from 'lucide-react'
import { api } from '@/lib/api'
import { useSnackbar } from '@/stores/snackbar'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageContainer, PageHeader, Select } from '@/components/ui'
import type { ProxyRoute } from '@/lib/types'
import { cn } from '@/lib/cn'

interface TestResult {
  valid: boolean
  ip?: string
  latencyMs?: number
  error?: string
}

const SCHEMES: Array<{ value: ProxyRoute['scheme']; label: string }> = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socks5', label: 'SOCKS5' },
]

export default function ProxyPage() {
  const notify = useSnackbar((s) => s.notify)
  const [routes, setRoutes] = useState<ProxyRoute[]>([])
  const [loading, setLoading] = useState(true)

  const [showAdd, setShowAdd] = useState(false)
  const [formName, setFormName] = useState('')
  const [formScheme, setFormScheme] = useState<ProxyRoute['scheme']>('http')
  const [formHost, setFormHost] = useState('')
  const [formPort, setFormPort] = useState('')
  const [formUser, setFormUser] = useState('')
  const [formPass, setFormPass] = useState('')
  const [saving, setSaving] = useState(false)

  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, TestResult>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const fetchRoutes = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ routes: ProxyRoute[] }>('/api/proxies')
      setRoutes(data.routes ?? [])
    } catch (err) {
      console.error('Error fetching proxy routes:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRoutes()
  }, [fetchRoutes])

  const handleAdd = async () => {
    const port = parseInt(formPort, 10)
    if (!formName.trim() || !formHost.trim() || !port) {
      notify('Name, host, and port are required', 'error')
      return
    }
    setSaving(true)
    try {
      await api.post('/api/proxies', {
        name: formName.trim(),
        scheme: formScheme,
        host: formHost.trim(),
        port,
        username: formUser.trim() || undefined,
        password: formPass || undefined,
        isEnabled: true,
      })
      notify('Proxy route added', 'success')
      setShowAdd(false)
      setFormName('')
      setFormScheme('http')
      setFormHost('')
      setFormPort('')
      setFormUser('')
      setFormPass('')
      await fetchRoutes()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to add proxy', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (route: ProxyRoute) => {
    try {
      await api.patch(`/api/proxies/${route.id}`, { isEnabled: !route.isEnabled })
      // Drop the stale test badge — a toggled route needs a fresh test.
      setTestResult((prev) => {
        const next = { ...prev }
        delete next[route.id]
        return next
      })
      await fetchRoutes()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to update proxy', 'error')
    }
  }

  const handleDelete = async (route: ProxyRoute) => {
    if (!confirm(`Delete proxy "${route.name}"? Connections using it fall back to direct.`)) return
    try {
      await api.del(`/api/proxies/${route.id}`)
      notify('Proxy route deleted', 'info')
      await fetchRoutes()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to delete proxy', 'error')
    }
  }

  const handleTest = async (route: ProxyRoute) => {
    setTesting(route.id)
    try {
      const res = await api.post<TestResult>(`/api/proxies/test/${route.id}`)
      setTestResult((prev) => ({ ...prev, [route.id]: res }))
    } catch (err) {
      setTestResult((prev) => ({
        ...prev,
        [route.id]: { valid: false, error: err instanceof Error ? err.message : 'Test failed' },
      }))
    } finally {
      setTesting(null)
    }
  }

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const proxyUrl = (r: ProxyRoute) =>
    r.username ? `${r.scheme}://${r.username}:•••@${r.host}:${r.port}` : `${r.scheme}://${r.host}:${r.port}`

  return (
    <PageContainer>
      <PageHeader
        title="Proxy"
        description="Outbound routes that hide your origin from providers. Attach a route to any provider connection in Providers."
        actions={
          <Button size="md" variant="primary" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add proxy
          </Button>
        }
      />

      {loading ? (
        <Card>
          <div className="flex flex-col gap-2.5">
            <div className="h-14 animate-pulse rounded-md bg-surface-2" />
            <div className="h-14 animate-pulse rounded-md bg-surface-2" />
          </div>
        </Card>
      ) : routes.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Globe size={28} />}
            title="No proxy routes"
            hint="Add a route and attach it to a provider connection to mask your outbound traffic."
            action={
              <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>
                <Plus size={13} /> Add proxy
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {routes.map((r) => {
            const res = testResult[r.id]
            return (
              <Card key={r.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  {/* Left: identity + URL */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={r.isEnabled ? 'success' : 'neutral'}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', r.isEnabled ? 'bg-success' : 'bg-subtle')} />
                        {r.isEnabled ? 'Active' : 'Disabled'}
                      </Badge>
                      <h3 className="truncate text-sm font-semibold text-text">{r.name}</h3>
                      <Badge tone="accent">{r.scheme.toUpperCase()}</Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <code className="tnum min-w-0 truncate rounded border border-border bg-surface-2 px-2 py-1 font-mono text-[11px] text-muted">
                        {proxyUrl(r)}
                      </code>
                      <button
                        onClick={() => copy(proxyUrl(r), r.id)}
                        className="shrink-0 text-subtle transition-colors hover:text-text"
                        title="Copy URL"
                        aria-label="Copy proxy URL"
                      >
                        {copiedId === r.id ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                    </div>
                    {res && (
                      <div className="mt-2 text-[11px]">
                        {res.valid ? (
                          <span className="text-success">
                            <ShieldCheck size={11} className="mr-1 inline" />
                            Verified — exit IP <strong className="tnum">{res.ip ?? 'unknown'}</strong>
                            {res.latencyMs ? <> · <span className="tnum">{Math.round(res.latencyMs)}ms</span></> : null}
                          </span>
                        ) : (
                          <span className="break-all text-danger">{res.error ?? 'Test failed'}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right: actions */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button size="sm" loading={testing === r.id} onClick={() => handleTest(r)} disabled={!r.isEnabled}>
                      <Zap size={12} /> Test
                    </Button>
                    <Button size="sm" onClick={() => handleToggle(r)}>
                      {r.isEnabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-subtle hover:text-danger" onClick={() => handleDelete(r)} aria-label={`Delete ${r.name}`}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add proxy route"
        subtitle="HTTP, HTTPS, or SOCKS5. Credentials optional."
        footer={
          <>
            <Button onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={handleAdd}>
              Add route
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. US residential 1" />
          </Field>
          <Field label="Scheme">
            <Select value={formScheme} onChange={(e) => setFormScheme(e.target.value as ProxyRoute['scheme'])}>
              {SCHEMES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Host">
            <Input value={formHost} onChange={(e) => setFormHost(e.target.value)} placeholder="proxy.example.com" />
          </Field>
          <Field label="Port">
            <Input type="number" value={formPort} onChange={(e) => setFormPort(e.target.value)} placeholder="8080" />
          </Field>
          <Field label="Username (optional)">
            <Input value={formUser} onChange={(e) => setFormUser(e.target.value)} placeholder="user" autoComplete="off" />
          </Field>
          <Field label="Password (optional)">
            <Input type="password" value={formPass} onChange={(e) => setFormPass(e.target.value)} placeholder="pass" autoComplete="new-password" />
          </Field>
        </div>
        <div className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[11px] text-muted">
          After adding, open <strong className="text-text">Providers → Edit credentials → Proxy route</strong> to bind this route to a connection.
        </div>
      </Modal>
    </PageContainer>
  )
}
