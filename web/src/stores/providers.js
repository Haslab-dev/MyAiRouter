import { create } from 'zustand';

export const useProviders = create((set, get) => ({
  connections: [],
  nodes: [],
  customModels: [],
  providerModels: {},
  enabledModelIds: null,
  viewingDetailProvider: null,
  modelPrefix: '',

  fetchAll: async () => {
    const [connRes, nodeRes, customRes, v1Res] = await Promise.all([
      fetch('/api/providers'),
      fetch('/api/provider-nodes'),
      fetch('/api/models/custom'),
      fetch('/v1/models'),
    ]);

    const connections = connRes.ok ? await connRes.json() : [];
    const nodes = nodeRes.ok ? (await nodeRes.json()).nodes || [] : [];
    const customModels = customRes.ok ? await customRes.json() : [];

    const grouped = {};
    if (v1Res.ok) {
      const v1data = await v1Res.json();
      (v1data.data || []).forEach(m => {
        const id = m.id || '';
        const slash = id.indexOf('/');
        const prov = slash > 0 ? id.slice(0, slash) : 'openai';
        const modelId = slash > 0 ? id.slice(slash + 1) : id;
        if (!grouped[prov]) grouped[prov] = [];
        if (!grouped[prov].some(x => x.id === modelId)) {
          grouped[prov].push({ id: modelId, name: modelId, ownedBy: m.owned_by || prov });
        }
      });
    }

    set({ connections, nodes, customModels, providerModels: grouped });
  },

  addCustomModel: async (providerAlias, id, name) => {
    const { customModels } = get();
    if (customModels.some(m => m.providerAlias === providerAlias && m.id === id)) return;
    const res = await fetch('/api/models/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerAlias, id, type: 'llm', name: name || id }),
    });
    if (res.ok) {
      set({ customModels: [...customModels, { providerAlias, id, type: 'llm', name: name || id }] });
    }
  },

  deleteCustomModel: async (providerAlias, id) => {
    await fetch(`/api/models/custom?providerAlias=${encodeURIComponent(providerAlias)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    const { customModels } = get();
    set({ customModels: customModels.filter(m => !(m.providerAlias === providerAlias && m.id === id)) });
  },

  fetchEnabledModels: async (providerAlias) => {
    const res = await fetch(`/api/models/enabled?providerAlias=${encodeURIComponent(providerAlias)}`);
    if (res.ok) {
      const data = await res.json();
      set({ enabledModelIds: data.ids || null });
    }
  },

  setEnabledModels: async (providerAlias, ids) => {
    await fetch('/api/models/enabled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerAlias, ids }),
    });
    set({ enabledModelIds: ids.length > 0 ? ids : null });
  },

  setViewingDetail: (provider, connections) => {
    const conn = connections ? connections.find(c => c.provider === provider.id) : null;
    set({
      viewingDetailProvider: provider,
      modelPrefix: conn?.data?.modelPrefix || '',
    });
    if (provider) get().fetchEnabledModels(provider.id);
  },

  clearViewingDetail: () => {
    set({ viewingDetailProvider: null, enabledModelIds: null, modelPrefix: '' });
  },

  updateConnectionData: async (connId, data) => {
    await fetch(`/api/providers/${connId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    get().fetchAll();
  },

  isProviderActive: (providerId) => {
    return get().connections.some(c => c.provider === providerId && c.isActive);
  },

  getProviderModels: (providerId) => {
    const { providerModels, customModels, enabledModelIds } = get();
    const fromGateway = providerModels[providerId] || [];
    const customs = customModels.filter(m => m.providerAlias === providerId);
    const all = [...fromGateway, ...customs];
    const isModelEnabled = (id) => enabledModelIds === null || enabledModelIds.includes(id);
    return { all, isModelEnabled };
  },
}));
