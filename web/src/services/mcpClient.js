export default class McpClient {
  constructor(config) {
    // Support both formats:
    // { url: '...', headers: { ... }, name: '...' }
    // or legacy: url, name
    if (typeof config === 'string') {
      this.url = config.replace(/\/$/, '');
      this.name = arguments[1] || config;
      this.headers = {};
    } else {
      this.url = (config.url || '').replace(/\/$/, '');
      this.name = config.name || config.url || '';
      this.headers = config.headers || {};
    }
    this.tools = [];
    this.connected = false;
    this.eventSource = null;
  }

  _fetchOptions(method, body) {
    return {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...this.headers
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    };
  }

  async connect() {
    try {
      const headers = new Headers(this.headers);
      const res = await fetch(`${this.url}/sse`, { headers });
      if (!res.ok) throw new Error(`SSE connection failed: ${res.status}`);

      this.eventSource = new EventSource(`${this.url}/sse`);
      this.connected = true;

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 10000);

        this.eventSource.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.method === 'initialize' || msg.result) {
              clearTimeout(timeout);
              resolve(msg);
            }
          } catch {}
        };

        this.eventSource.onerror = () => {
          clearTimeout(timeout);
          this.connected = false;
          reject(new Error('SSE connection error'));
        };
      });
    } catch (e) {
      this.connected = false;
      throw e;
    }
  }

  async listTools() {
    const res = await fetch(`${this.url}/tools/list`, this._fetchOptions('POST', {
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 1
    }));
    if (!res.ok) throw new Error(`List tools failed: ${res.status}`);
    const data = await res.json();
    this.tools = data.result?.tools || [];
    return this.tools;
  }

  async callTool(name, args = {}) {
    const res = await fetch(`${this.url}/tools/call`, this._fetchOptions('POST', {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name, arguments: args },
      id: Date.now()
    }));
    if (!res.ok) throw new Error(`Tool call failed: ${res.status}`);
    const data = await res.json();
    return data.result;
  }

  disconnect() {
    this.eventSource?.close();
    this.eventSource = null;
    this.connected = false;
    this.tools = [];
  }
}
