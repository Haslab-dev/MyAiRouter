import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Network } from 'lucide-react'
import { api, ApiRequestError } from '@/lib/api'
import { useSnackbar } from '@/stores/snackbar'
import { Button, Card, CardHeader, Input, PageContainer, PageHeader, Table, Td, Badge } from '@/components/ui'
import type { ApiKeyEntry } from '@/lib/types'

export default function EndpointPage() {
  const notify = useSnackbar((s) => s.notify)
  const [keys, setKeys] = useState<ApiKeyEntry[]>([])
  const [newKeyName, setNewKeyName] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const baseUrl = `${window.location.protocol}//${window.location.host}`
  const gatewayUrl = `${baseUrl}/v1`

  const fetchKeys = async () => {
    try {
      const data = await api.get<ApiKeyEntry[]>('/api/keys')
      setKeys(data ?? [])
    } catch (err) {
      console.error('Error fetching API keys:', err)
    }
  }

  useEffect(() => {
    fetchKeys()
  }, [])

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKeyName.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post('/api/keys', { name: newKeyName })
      setNewKeyName('')
      await fetchKeys()
      notify('API key created', 'success')
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : 'Connection error'
      setError(msg)
      notify(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteKey = async (id: string) => {
    if (!confirm('Delete this API key? Clients using it will lose access immediately.')) return
    try {
      await api.del(`/api/keys?id=${id}`)
      await fetchKeys()
      notify('API key deleted', 'info')
    } catch (err) {
      console.error('Error deleting key:', err)
      notify('Error deleting key', 'error')
    }
  }

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <PageContainer>
      <PageHeader
        title="Gateway"
        description="Ingress endpoints and access keys for clients — code editors, CLI tools, and agent frameworks."
      />

      <Card className="mb-5">
        <CardHeader title="Endpoints" subtitle="Point any OpenAI-compatible client at the base URL below." />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted">API base URL</div>
            <div className="flex gap-2">
              <Input readOnly value={gatewayUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button size="md" onClick={() => copy(gatewayUrl, 'base')}>
                {copiedId === 'base' ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted">Health check</div>
            <Input readOnly value={`${baseUrl}/api/health`} className="font-mono text-xs opacity-70" />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-1.5">
              <KeyRound size={14} className="text-accent" /> Access keys
            </span>
          }
          subtitle="Authenticate requests with Authorization: Bearer <key>."
        />

        <form onSubmit={handleCreateKey} className="mb-5 flex gap-2">
          <Input
            placeholder="Key label (e.g. VS Code, Cline, Cursor)"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            disabled={loading}
            className="max-w-sm"
          />
          <Button type="submit" variant="primary" loading={loading}>
            Generate key
          </Button>
        </form>

        {error && <p className="mb-4 text-[13px] text-danger">{error}</p>}

        <Table headers={['Label', 'Key', 'Created', 'Status', '']}>
          {keys.length === 0 ? (
            <tr>
              <Td colSpan={5} className="py-8 text-center text-subtle">
                No access keys yet — generate one above.
              </Td>
            </tr>
          ) : (
            keys.map((k) => (
              <tr key={k.id}>
                <Td className="font-medium">{k.name || 'Unnamed key'}</Td>
                <Td>
                  <code className="tnum font-mono text-xs text-muted">{k.key}</code>
                </Td>
                <Td className="text-muted">{new Date(k.createdAt).toLocaleDateString()}</Td>
                <Td>
                  <Badge tone="success">Active</Badge>
                </Td>
                <Td>
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" onClick={() => copy(k.key, k.id)}>
                      {copiedId === k.id ? <Check size={12} /> : <Copy size={12} />}
                      {copiedId === k.id ? 'Copied' : 'Copy'}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handleDeleteKey(k.id)}>
                      Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </Table>

        <div className="mt-4 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-xs text-muted">
          <Network size={14} className="mt-0.5 shrink-0 text-subtle" />
          <span>
            The gateway is a plain pass-through: requests are forwarded byte-for-byte to the selected upstream. Caching belongs
            in your client or agent tooling, not here.
          </span>
        </div>
      </Card>
    </PageContainer>
  )
}
