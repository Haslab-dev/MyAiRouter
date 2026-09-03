import { create } from 'zustand';
import McpClient from '../services/mcpClient';

const STORAGE_KEY = 'myairouter_chat_config';

const DEFAULT_SKILLS = [
  { id: 'myairouter', name: 'myAiRouter (Entry)', description: 'Setup + index of all capabilities', icon: 'hub', isEntry: true, content: '' },
  { id: 'myairouter-chat', name: 'Chat / Code-gen', description: 'Multi-turn conversation and stream completions', endpoint: '/v1/chat/completions', icon: 'chat', content: '' },
  { id: 'myairouter-token-saver', name: 'Token Saving', description: 'Compression specifications (Bolt, Headroom, Caveman, Ponytail)', endpoint: '/api/settings', icon: 'bolt', content: '' },
];

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        mcpServers: (data.mcpServers || []).map(s => ({ ...s, status: 'disconnected', tools: [], client: null })),
        activeMcpServerIds: data.activeMcpServerIds || [],
        customSkills: data.customSkills || []
      };
    }
  } catch {}
  return { mcpServers: [], activeMcpServerIds: [], customSkills: [] };
}

function persist(state) {
  try {
    const { mcpServers, activeMcpServerIds, customSkills } = state;
    const toSave = {
      mcpServers: mcpServers.map(({ id, name, url, headers }) => ({ id, name, url, headers })),
      activeMcpServerIds,
      customSkills
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {}
}

const persisted = loadPersisted();

export const useChatStore = create((set, get) => ({
  mcpServers: persisted.mcpServers,
  activeMcpServerIds: persisted.activeMcpServerIds,
  skills: DEFAULT_SKILLS,
  customSkills: persisted.customSkills,

  addMcpServer: (config) => {
    const server = {
      id: `mcp-${Date.now()}`,
      name: config.name || config.url,
      url: config.url,
      headers: config.headers || {},
      status: 'disconnected',
      tools: []
    };
    set(state => {
      const next = { mcpServers: [...state.mcpServers, server] };
      setTimeout(() => persist({ ...get(), ...next }), 0);
      return next;
    });
    return server;
  },

  removeMcpServer: (id) => {
    const server = get().mcpServers.find(s => s.id === id);
    server?.client?.disconnect();
    set(state => {
      const next = {
        mcpServers: state.mcpServers.filter(s => s.id !== id),
        activeMcpServerIds: state.activeMcpServerIds.filter(sid => sid !== id)
      };
      setTimeout(() => persist({ ...get(), ...next }), 0);
      return next;
    });
  },

  connectMcpServer: async (id) => {
    const server = get().mcpServers.find(s => s.id === id);
    if (!server) return;

    const client = new McpClient({
      url: server.url,
      name: server.name,
      headers: server.headers
    });
    set(state => ({
      mcpServers: state.mcpServers.map(s =>
        s.id === id ? { ...s, status: 'connecting', client } : s
      )
    }));

    try {
      await client.connect();
      const tools = await client.listTools();
      set(state => {
        const next = {
          mcpServers: state.mcpServers.map(s =>
            s.id === id ? { ...s, status: 'connected', tools, client } : s
          ),
          activeMcpServerIds: [...state.activeMcpServerIds, id]
        };
        setTimeout(() => persist({ ...get(), ...next }), 0);
        return next;
      });
    } catch (e) {
      set(state => ({
        mcpServers: state.mcpServers.map(s =>
          s.id === id ? { ...s, status: 'error', error: e.message } : s
        )
      }));
    }
  },

  disconnectMcpServer: (id) => {
    const server = get().mcpServers.find(s => s.id === id);
    server?.client?.disconnect();
    set(state => {
      const next = {
        mcpServers: state.mcpServers.map(s =>
          s.id === id ? { ...s, status: 'disconnected', tools: [], client: null } : s
        ),
        activeMcpServerIds: state.activeMcpServerIds.filter(sid => sid !== id)
      };
      setTimeout(() => persist({ ...get(), ...next }), 0);
      return next;
    });
  },

  toggleMcpServer: (id) => {
    const { activeMcpServerIds } = get();
    set(state => {
      const next = {
        activeMcpServerIds: activeMcpServerIds.includes(id)
          ? activeMcpServerIds.filter(sid => sid !== id)
          : [...activeMcpServerIds, id]
      };
      setTimeout(() => persist({ ...get(), ...next }), 0);
      return next;
    });
  },

  getActiveMcpTools: () => {
    const { mcpServers, activeMcpServerIds } = get();
    const tools = [];
    for (const server of mcpServers) {
      if (activeMcpServerIds.includes(server.id) && server.tools) {
        for (const tool of server.tools) {
          tools.push({
            ...tool,
            _serverId: server.id,
            _serverName: server.name
          });
        }
      }
    }
    return tools;
  },

  callMcpTool: async (serverId, toolName, args) => {
    const server = get().mcpServers.find(s => s.id === serverId);
    if (!server?.client) throw new Error('MCP server not connected');
    return await server.client.callTool(toolName, args);
  },

  addCustomSkill: (name, description, content) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);
    const id = slug || `skill-${Date.now()}`;
    const existing = get().customSkills.find(s => s.id === id);
    const skill = {
      id: existing ? `${id}-${Date.now()}` : id,
      name,
      description: description || '',
      content: content || '',
      icon: 'extension',
      isCustom: true
    };
    set(state => {
      const next = { customSkills: [...state.customSkills, skill] };
      setTimeout(() => persist({ ...get(), ...next }), 0);
      return next;
    });
    return skill;
  },

  removeCustomSkill: (id) => {
    set(state => {
      const next = { customSkills: state.customSkills.filter(s => s.id !== id) };
      setTimeout(() => persist({ ...get(), ...next }), 0);
      return next;
    });
  },

  getAllSkills: () => {
    return [...get().skills, ...get().customSkills];
  },

  reconnectAll: async () => {
    const { mcpServers } = get();
    for (const server of mcpServers) {
      if (server.url && server.status === 'disconnected') {
        get().connectMcpServer(server.id).catch(() => {});
      }
    }
  }
}));
