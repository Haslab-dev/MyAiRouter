/** Minimal MCP (Model Context Protocol) HTTP+SSE client used by the chat playground. */

interface McpClientConfig {
  url: string
  name?: string
  headers?: Record<string, string>
}

export default class McpClient {
  url: string
  name: string
  headers: Record<string, string>
  tools: Array<{ name: string; description?: string }> = []
  connected = false
  private eventSource: EventSource | null = null

  constructor(config: McpClientConfig | string) {
    if (typeof config === 'string') {
      this.url = config.replace(/\/$/, '')
      this.name = config
      this.headers = {}
    } else {
      this.url = (config.url || '').replace(/\/$/, '')
      this.name = config.name || config.url || ''
      this.headers = config.headers ?? {}
    }
  }

  private fetchOptions(method: string, body?: unknown): RequestInit {
    return {
      method,
      headers: { 'Content-Type': 'application/json', ...this.headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }
  }

  async connect(): Promise<unknown> {
    const res = await fetch(`${this.url}/sse`, { headers: new Headers(this.headers) })
    if (!res.ok) throw new Error(`SSE connection failed: ${res.status}`)

    this.eventSource = new EventSource(`${this.url}/sse`)
    this.connected = true

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10_000)
      this.eventSource!.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.method === 'initialize' || msg.result) {
            clearTimeout(timeout)
            resolve(msg)
          }
        } catch {
          /* ignore malformed keepalives */
        }
      }
      this.eventSource!.onerror = () => {
        clearTimeout(timeout)
        this.connected = false
        reject(new Error('SSE connection error'))
      }
    })
  }

  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    const res = await fetch(this.url + '/tools/list', this.fetchOptions('POST', { jsonrpc: '2.0', method: 'tools/list', id: 1 }))
    if (!res.ok) throw new Error(`List tools failed: ${res.status}`)
    const data = await res.json()
    this.tools = data.result?.tools ?? []
    return this.tools
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const res = await fetch(
      this.url + '/tools/call',
      this.fetchOptions('POST', { jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: Date.now() }),
    )
    if (!res.ok) throw new Error(`Tool call failed: ${res.status}`)
    const data = await res.json()
    return data.result
  }

  disconnect() {
    this.eventSource?.close()
    this.eventSource = null
    this.connected = false
    this.tools = []
  }
}
