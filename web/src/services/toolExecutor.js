const BROWSER_TOOLS = [
  {
    name: 'web_search',
    description: 'Search the web for information',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' }
      },
      required: ['query']
    },
    execute: async ({ query }) => {
      const res = await fetch('/api/tools/web-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      return await res.json();
    }
  },
  {
    name: 'web_fetch',
    description: 'Fetch and extract content from a URL',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' }
      },
      required: ['url']
    },
    execute: async ({ url }) => {
      const res = await fetch('/api/tools/web-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      return await res.json();
    }
  },
  {
    name: 'calculate',
    description: 'Evaluate a mathematical expression',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Math expression to evaluate' }
      },
      required: ['expression']
    },
    execute: async ({ expression }) => {
      try {
        const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
        const result = Function(`"use strict"; return (${sanitized})`)();
        return { result, expression };
      } catch (e) {
        return { error: e.message, expression };
      }
    }
  },
  {
    name: 'get_time',
    description: 'Get the current date and time',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({
      datetime: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    })
  }
];

export async function executeTool(name, args) {
  const tool = BROWSER_TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return await tool.execute(args);
}

export function getToolDefinitions() {
  return BROWSER_TOOLS.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  }));
}

export function getToolNames() {
  return BROWSER_TOOLS.map(t => t.name);
}
