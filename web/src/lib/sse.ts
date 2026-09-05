/**
 * Shared SSE streaming client for /v1/chat/completions.
 *
 * Handles the full chunk surface the gateway can emit: content deltas,
 * reasoning deltas (reasoning_content / reasoning / thought), inline
 * <think>...</think> tags, tool-call deltas and final usage stats.
 */

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
}

export interface ToolCallDelta {
  id?: string
  name?: string
  argumentsDelta?: string
}

export interface StreamEvent {
  content?: string
  reasoning?: string
  finishReason?: string | null
  usage?: TokenUsage | null
  toolCalls?: ToolCallDelta[]
  error?: string
}

export interface StreamChatOptions {
  signal?: AbortSignal
  onEvent?: (event: StreamEvent) => void
  /** Raw SSE payloads (data: JSON strings), for advanced consumers. */
  onData?: (payload: string) => void
}

interface ParsedChunk {
  content: string
  reasoning: string
  finishReason: string | null
  usage: TokenUsage | null
  toolCalls: ToolCallDelta[]
  error?: string
}

function extractUsage(usage: Record<string, unknown> | undefined): TokenUsage | null {
  if (!usage || typeof usage !== 'object') return null
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : 0)
  let prompt = num(usage.prompt_tokens) || num(usage.input_tokens) || num(usage.prompt_eval_count)
  let completion = num(usage.completion_tokens) || num(usage.output_tokens) || num(usage.eval_count)
  let cached = 0
  for (const key of ['cache_creation_input_tokens', 'cache_read_input_tokens', 'cached_tokens']) {
    cached += num(usage[key])
  }
  if (usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object') {
    const details = usage.prompt_tokens_details as Record<string, unknown>
    for (const key of ['cache_creation_input_tokens', 'cache_read_input_tokens', 'cached_tokens']) {
      cached += num(details[key])
    }
  }
  const meta = usage.usageMetadata as Record<string, unknown> | undefined
  if (meta) {
    prompt = prompt || num(meta.promptTokenCount)
    completion = completion || num(meta.candidatesTokenCount)
  }
  if (!prompt && !completion && !cached) return null
  return { promptTokens: prompt, completionTokens: completion, cachedTokens: cached }
}

function parsePayload(payload: string): ParsedChunk | null {
  if (payload === '[DONE]') return { content: '', reasoning: '', finishReason: 'stop', usage: null, toolCalls: [] }
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(payload)
  } catch {
    return null
  }
  if (obj.error) {
    const err = obj.error as Record<string, unknown>
    return { content: '', reasoning: '', finishReason: null, usage: null, toolCalls: [], error: String(err.message ?? 'Upstream error') }
  }

  const chunk: ParsedChunk = { content: '', reasoning: '', finishReason: null, usage: null, toolCalls: [] }

  const usage = obj.usage as Record<string, unknown> | undefined
  chunk.usage = extractUsage(usage)

  const choices = obj.choices as Array<Record<string, unknown>> | undefined
  if (choices && choices.length > 0) {
    const choice = choices[0]
    if (typeof choice.finish_reason === 'string') chunk.finishReason = choice.finish_reason

    const delta = (choice.delta ?? choice.message) as Record<string, unknown> | undefined
    if (delta) {
      if (typeof delta.content === 'string') chunk.content = delta.content
      if (typeof delta.reasoning_content === 'string') chunk.reasoning = delta.reasoning_content
      else if (typeof delta.reasoning === 'string') chunk.reasoning = delta.reasoning
      else if (typeof delta.thought === 'string') chunk.reasoning = delta.thought

      const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined
      if (Array.isArray(toolCalls)) {
        chunk.toolCalls = toolCalls.map((tc) => {
          const fn = tc.function as Record<string, unknown> | undefined
          return {
            id: typeof tc.id === 'string' ? tc.id : undefined,
            name: typeof fn?.name === 'string' ? fn.name : undefined,
            argumentsDelta: typeof fn?.arguments === 'string' ? fn.arguments : undefined,
          }
        })
      }
    }
  }
  return chunk
}

/**
 * Stream a chat completion, invoking onEvent for every delta.
 * Returns the accumulated content, reasoning and usage.
 */
export async function streamChatCompletion(
  body: Record<string, unknown>,
  options: StreamChatOptions = {},
): Promise<{ content: string; reasoning: string; usage: TokenUsage | null; finishReason: string | null }> {
  const { signal, onEvent, onData } = options

  const res = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })

  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error?.message) message = data.error.message
      else if (typeof data?.error === 'string') message = data.error
    } catch {
      /* keep default */
    }
    throw new Error(message)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let finishReason: string | null = null
  let usage: TokenUsage | null = null
  let insideThink = false

  const handleChunk = (chunk: ParsedChunk | null) => {
    if (!chunk) return
    if (chunk.error) throw new Error(chunk.error)
    if (chunk.finishReason) finishReason = chunk.finishReason
    if (chunk.usage) usage = chunk.usage

    if (chunk.reasoning) {
      reasoning += chunk.reasoning
      onEvent?.({ reasoning: chunk.reasoning })
    }

    if (chunk.content) {
      // Inline <think> tags arrive as content; route them to reasoning.
      let text = chunk.content
      if (insideThinkTag(text, insideThink)) {
        const { out, opened, closed } = splitThink(text, insideThink)
        insideThink = !closed
        if (out) {
          if (opened) {
            reasoning += out
            onEvent?.({ reasoning: out })
          } else {
            content += out
            onEvent?.({ content: out })
          }
        }
        text = ''
      }
      if (text) {
        content += text
        onEvent?.({ content: text })
      }
    }

    if (chunk.toolCalls.length > 0) onEvent?.({ toolCalls: chunk.toolCalls })
    if (chunk.finishReason && chunk.usage) onEvent?.({ finishReason: chunk.finishReason, usage: chunk.usage })
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload) continue
        onData?.(payload)
        handleChunk(parsePayload(payload))
      }
    }
  } finally {
    reader.releaseLock()
  }

  return { content, reasoning, usage, finishReason }
}

function insideThinkTag(text: string, currentlyInside: boolean): boolean {
  return currentlyInside || text.includes('<think>')
}

function splitThink(text: string, alreadyInside: boolean): { out: string; opened: boolean; closed: boolean } {
  if (alreadyInside) {
    const idx = text.indexOf('</think>')
    if (idx === -1) return { out: text, opened: true, closed: false }
    return { out: text.slice(0, idx), opened: true, closed: true }
  }
  const open = text.indexOf('<think>')
  if (open === -1) return { out: text, opened: false, closed: false }
  const after = text.slice(open + 7)
  const close = after.indexOf('</think>')
  if (close === -1) return { out: after, opened: true, closed: false }
  return { out: after.slice(0, close), opened: true, closed: true }
}

/** Non-streaming chat completion (used by simple helpers / title generation). */
export async function chatCompletion(body: Record<string, unknown>, signal?: AbortSignal): Promise<{ content: string; usage: TokenUsage | null }> {
  const res = await fetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: false }),
    signal,
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      message = data?.error?.message ?? message
    } catch {
      /* keep default */
    }
    throw new Error(message)
  }
  const data = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? ''
  return { content, usage: extractUsage(data?.usage) }
}
