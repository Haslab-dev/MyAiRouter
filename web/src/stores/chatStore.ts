import { create } from 'zustand'
import McpClient from '@/services/mcpClient'

const STORAGE_KEY = 'myairouter_chat_config'

export interface McpTool {
  name: string
  description?: string
  [key: string]: unknown
}

export interface McpServer {
  id: string
  name: string
  url: string
  headers: Record<string, string>
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  tools: McpTool[]
  client: McpClient | null
  error?: string
}

export interface Skill {
  id: string
  name: string
  description?: string
  icon?: string
  isEntry?: boolean
  isCustom?: boolean
  endpoint?: string
  content: string
}

const DEFAULT_SKILLS: Skill[] = [
  { id: 'myairouter', name: 'myAiRouter (Entry)', description: 'Setup + index of all capabilities', icon: 'hub', isEntry: true, content: '' },
  { id: 'myairouter-chat', name: 'Chat / Code-gen', description: 'Multi-turn conversation and stream completions', endpoint: '/v1/chat/completions', icon: 'chat', content: '' },
  { id: 'myairouter-token-saver', name: 'Token Saving', description: 'Compression specifications (Bolt, Headroom, Caveman, Ponytail)', endpoint: '/api/settings', icon: 'bolt', content: '' },
]

interface PersistedConfig {
  mcpServers: McpServer[]
  activeMcpServerIds: string[]
  customSkills: Skill[]
}

function loadPersisted(): PersistedConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      return {
        mcpServers: (data.mcpServers ?? []).map((s: Partial<McpServer>): McpServer => ({ ...(s as McpServer), status: 'disconnected', tools: [], client: null })),
        activeMcpServerIds: data.activeMcpServerIds ?? [],
        customSkills: data.customSkills ?? [],
      }
    }
  } catch {
    /* corrupted config */
  }
  return { mcpServers: [], activeMcpServerIds: [], customSkills: [] }
}

function persist(state: { mcpServers: McpServer[]; activeMcpServerIds: string[]; customSkills: Skill[] }) {
  try {
    const toSave = {
      mcpServers: state.mcpServers.map(({ id, name, url, headers }) => ({ id, name, url, headers })),
      activeMcpServerIds: state.activeMcpServerIds,
      customSkills: state.customSkills,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
  } catch {
    /* storage full */
  }
}

const persisted = loadPersisted()

interface ChatStoreState {
  mcpServers: McpServer[]
  activeMcpServerIds: string[]
  skills: Skill[]
  customSkills: Skill[]
  addMcpServer: (config: { name?: string; url: string; headers?: Record<string, string> }) => McpServer
  removeMcpServer: (id: string) => void
  connectMcpServer: (id: string) => Promise<void>
  disconnectMcpServer: (id: string) => void
  toggleMcpServer: (id: string) => void
  reconnectAll: () => Promise<void>
  getActiveMcpTools: () => Array<McpTool & { _serverId: string; _serverName: string }>
  callMcpTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>
  getAllSkills: () => Skill[]
  addCustomSkill: (name: string, description?: string, content?: string) => Skill
  removeCustomSkill: (id: string) => void
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  mcpServers: persisted.mcpServers,
  activeMcpServerIds: persisted.activeMcpServerIds,
  skills: DEFAULT_SKILLS,
  customSkills: persisted.customSkills,

  addMcpServer: (config) => {
    const server: McpServer = {
      id: `mcp-${Date.now()}`,
      name: config.name || config.url,
      url: config.url,
      headers: config.headers ?? {},
      status: 'disconnected',
      tools: [],
      client: null,
    }
    set((state) => {
      const next = { mcpServers: [...state.mcpServers, server] }
      setTimeout(() => persist({ ...get(), ...next }), 0)
      return next
    })
    return server
  },

  removeMcpServer: (id) => {
    const server = get().mcpServers.find((s) => s.id === id)
    server?.client?.disconnect()
    set((state) => {
      const next = {
        mcpServers: state.mcpServers.filter((s) => s.id !== id),
        activeMcpServerIds: state.activeMcpServerIds.filter((sid) => sid !== id),
      }
      setTimeout(() => persist({ ...get(), ...next }), 0)
      return next
    })
  },

  connectMcpServer: async (id) => {
    const server = get().mcpServers.find((s) => s.id === id)
    if (!server) return

    const client = new McpClient({ url: server.url, name: server.name, headers: server.headers })
    set((state) => ({
      mcpServers: state.mcpServers.map((s) => (s.id === id ? { ...s, status: 'connecting', client } : s)),
    }))

    try {
      await client.connect()
      const tools = await client.listTools()
      set((state) => {
        const next = {
          mcpServers: state.mcpServers.map((s) => (s.id === id ? { ...s, status: 'connected' as const, tools, client } : s)),
          activeMcpServerIds: [...state.activeMcpServerIds, id],
        }
        setTimeout(() => persist({ ...get(), ...next }), 0)
        return next
      })
    } catch (e) {
      set((state) => ({
        mcpServers: state.mcpServers.map((s) => (s.id === id ? { ...s, status: 'error' as const, error: e instanceof Error ? e.message : String(e) } : s)),
      }))
    }
  },

  disconnectMcpServer: (id) => {
    const server = get().mcpServers.find((s) => s.id === id)
    server?.client?.disconnect()
    set((state) => {
      const next = {
        mcpServers: state.mcpServers.map((s) => (s.id === id ? { ...s, status: 'disconnected' as const, tools: [], client: null } : s)),
        activeMcpServerIds: state.activeMcpServerIds.filter((sid) => sid !== id),
      }
      setTimeout(() => persist({ ...get(), ...next }), 0)
      return next
    })
  },

  toggleMcpServer: (id) => {
    set((state) => {
      const next = {
        activeMcpServerIds: state.activeMcpServerIds.includes(id)
          ? state.activeMcpServerIds.filter((sid) => sid !== id)
          : [...state.activeMcpServerIds, id],
      }
      setTimeout(() => persist({ ...get(), ...next }), 0)
      return next
    })
  },

  reconnectAll: async () => {
    const { mcpServers, connectMcpServer } = get()
    for (const server of mcpServers) {
      if (server.status === 'disconnected') await connectMcpServer(server.id)
    }
  },

  getActiveMcpTools: () => {
    const { mcpServers, activeMcpServerIds } = get()
    const tools: Array<McpTool & { _serverId: string; _serverName: string }> = []
    for (const server of mcpServers) {
      if (activeMcpServerIds.includes(server.id) && server.tools) {
        for (const tool of server.tools) {
          tools.push({ ...tool, _serverId: server.id, _serverName: server.name })
        }
      }
    }
    return tools
  },

  callMcpTool: async (serverId, toolName, args) => {
    const server = get().mcpServers.find((s) => s.id === serverId)
    if (!server?.client) throw new Error('MCP server not connected')
    return await server.client.callTool(toolName, args)
  },

  getAllSkills: () => [...get().skills, ...get().customSkills],

  addCustomSkill: (name, description, content) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20)
    const id = slug || `skill-${Date.now()}`
    const existing = get().customSkills.find((s) => s.id === id)
    const skill: Skill = {
      id: existing ? `${id}-${Date.now()}` : id,
      name,
      description: description ?? '',
      content: content ?? '',
      icon: 'extension',
      isCustom: true,
    }
    set((state) => {
      const next = { customSkills: [...state.customSkills, skill] }
      setTimeout(() => persist({ ...get(), ...next }), 0)
      return next
    })
    return skill
  },

  removeCustomSkill: (id) => {
    set((state) => {
      const next = { customSkills: state.customSkills.filter((s) => s.id !== id) }
      setTimeout(() => persist({ ...get(), ...next }), 0)
      return next
    })
  },
}))
