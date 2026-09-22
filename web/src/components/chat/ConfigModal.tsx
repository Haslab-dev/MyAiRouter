import { useState } from 'react'
import { Copy, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useChatStore, type McpServer } from '@/stores/chatStore'
import { Badge, Button, Field, Input, Modal, Tabs, Textarea, Toggle, type BadgeTone } from '@/components/ui'
import { cn } from '@/lib/cn'

const statusTone: Record<McpServer['status'], BadgeTone> = {
  connected: 'success',
  connecting: 'warning',
  disconnected: 'neutral',
  error: 'danger',
}

export default function ConfigModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'mcp' | 'skills'>('mcp')
  const [error, setError] = useState('')
  const [mcpName, setMcpName] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [mcpHeaders, setMcpHeaders] = useState('')
  const [skillName, setSkillName] = useState('')
  const [skillDesc, setSkillDesc] = useState('')
  const [skillContent, setSkillContent] = useState('')

  const mcpServers = useChatStore((s) => s.mcpServers)
  const activeMcpServerIds = useChatStore((s) => s.activeMcpServerIds)
  const addMcpServer = useChatStore((s) => s.addMcpServer)
  const removeMcpServer = useChatStore((s) => s.removeMcpServer)
  const connectMcpServer = useChatStore((s) => s.connectMcpServer)
  const disconnectMcpServer = useChatStore((s) => s.disconnectMcpServer)
  const toggleMcpServer = useChatStore((s) => s.toggleMcpServer)
  const skills = useChatStore((s) => s.skills)
  const customSkills = useChatStore((s) => s.customSkills)
  const addCustomSkill = useChatStore((s) => s.addCustomSkill)
  const removeCustomSkill = useChatStore((s) => s.removeCustomSkill)

  const handleAddMcp = async () => {
    setError('')
    if (!mcpUrl.trim().startsWith('http')) {
      setError('Server URL must start with http:// or https://')
      return
    }
    let headers: Record<string, string> = {}
    if (mcpHeaders.trim()) {
      try {
        headers = JSON.parse(mcpHeaders)
      } catch {
        setError('Headers must be valid JSON')
        return
      }
    }
    const server = addMcpServer({ url: mcpUrl.trim(), name: mcpName.trim() || undefined, headers })
    setMcpName('')
    setMcpUrl('')
    setMcpHeaders('')
    await connectMcpServer(server.id)
  }

  const handleAddSkill = () => {
    if (!skillName.trim()) {
      setError('Skill name is required')
      return
    }
    addCustomSkill(skillName.trim(), skillDesc.trim(), skillContent)
    setSkillName('')
    setSkillDesc('')
    setSkillContent('')
    setError('')
  }

  const handleExportConfig = () => {
    const config: Record<string, { url: string; headers: Record<string, string> }> = {}
    for (const server of mcpServers) {
      config[server.name] = { url: server.url, headers: server.headers }
    }
    navigator.clipboard.writeText(JSON.stringify(config, null, 2))
  }

  const handleImportConfig = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const config = JSON.parse(text)
      for (const [name, cfg] of Object.entries(config)) {
        const c = cfg as { url: string; headers?: Record<string, string> }
        if (c.url) {
          const server = addMcpServer({ url: c.url, name, headers: c.headers ?? {} })
          await connectMcpServer(server.id)
        }
      }
    } catch {
      setError('Clipboard does not contain a valid config JSON')
    }
  }

  return (
    <Modal open={isOpen} onClose={onClose} title="Chat configuration" subtitle="MCP servers and skills for the playground." width="max-w-2xl">
      <div className="mb-4">
        <Tabs
          tabs={[
            { id: 'mcp', label: `MCP servers (${mcpServers.length})` },
            { id: 'skills', label: `Skills (${skills.length + customSkills.length})` },
          ]}
          active={tab}
          onChange={(id) => {
            setTab(id as 'mcp' | 'skills')
            setError('')
          }}
        />
      </div>

      {error && <p className="mb-3 text-xs text-danger">{error}</p>}

      {tab === 'mcp' ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {mcpServers.map((server) => (
              <div key={server.id} className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{server.name}</span>
                    <Badge tone={statusTone[server.status]}>{server.status}</Badge>
                    {server.tools.length > 0 && <span className="text-[10px] text-subtle">{server.tools.length} tools</span>}
                  </div>
                  <code className="block truncate font-mono text-[10px] text-subtle">{server.url}</code>
                  {server.error && <span className="text-[10px] text-danger">{server.error}</span>}
                </div>
                <Toggle
                  checked={activeMcpServerIds.includes(server.id)}
                  onChange={() => toggleMcpServer(server.id)}
                  label={`Activate ${server.name}`}
                />
                {server.status === 'connected' ? (
                  <Button size="sm" variant="ghost" onClick={() => disconnectMcpServer(server.id)}>
                    Disconnect
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => connectMcpServer(server.id)}>
                    <RefreshCw size={12} className={cn(server.status === 'connecting' && 'animate-spin')} />
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-subtle hover:text-danger" onClick={() => removeMcpServer(server.id)}>
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
            {mcpServers.length === 0 && <p className="py-2 text-center text-xs text-subtle">No MCP servers configured yet.</p>}
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="mb-2 text-xs font-semibold">Add MCP server</div>
            <div className="flex flex-col gap-2">
              <Input placeholder="Display name (optional)" value={mcpName} onChange={(e) => setMcpName(e.target.value)} />
              <Input placeholder="https://server.example.com" value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} className="font-mono text-xs" />
              <Textarea placeholder='Headers JSON (optional): {"Authorization": "Bearer …"}' value={mcpHeaders} onChange={(e) => setMcpHeaders(e.target.value)} className="min-h-14 font-mono text-xs" />
              <div className="flex items-center gap-2 self-end">
                <Button size="sm" onClick={handleImportConfig}>
                  Import from clipboard
                </Button>
                <Button size="sm" onClick={handleExportConfig}>
                  <Copy size={12} /> Export
                </Button>
                <Button size="sm" variant="primary" onClick={handleAddMcp}>
                  <Plus size={12} /> Add & connect
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            {[...skills, ...customSkills].map((skill) => (
              <div key={skill.id} className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{skill.name}</span>
                    {skill.isEntry && <Badge tone="accent">entry</Badge>}
                    {skill.isCustom && <Badge>custom</Badge>}
                  </div>
                  {skill.description && <div className="truncate text-[11px] text-muted">{skill.description}</div>}
                </div>
                {skill.isCustom && (
                  <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-subtle hover:text-danger" onClick={() => removeCustomSkill(skill.id)}>
                    <Trash2 size={12} />
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="mb-2 text-xs font-semibold">Add custom skill</div>
            <div className="flex flex-col gap-2">
              <Field label="Name">
                <Input value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="My skill" />
              </Field>
              <Field label="Description">
                <Input value={skillDesc} onChange={(e) => setSkillDesc(e.target.value)} placeholder="What it does" />
              </Field>
              <Field label="Content (injected as context when invoked)">
                <Textarea value={skillContent} onChange={(e) => setSkillContent(e.target.value)} className="min-h-24 font-mono text-xs" />
              </Field>
              <Button size="sm" variant="primary" className="self-end" onClick={handleAddSkill}>
                <Plus size={12} /> Add skill
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
