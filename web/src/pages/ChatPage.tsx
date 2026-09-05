import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Bot,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  MessageSquarePlus,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings2,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer'
import ThinkingSection from '@/components/chat/ThinkingSection'
import ImageLightbox from '@/components/chat/ImageLightbox'
import ToolCallCard from '@/components/chat/ToolCallCard'
import SlashCommandPopup from '@/components/chat/SlashCommandPopup'
import ConfigModal from '@/components/chat/ConfigModal'
import { useSlashCommands } from '@/hooks/useSlashCommands'
import { executeTool, getToolDefinitions } from '@/services/toolExecutor'
import { parseSlashCommand } from '@/services/slashCommandRegistry'
import { useChatStore } from '@/stores/chatStore'
import { streamChatCompletion, type StreamEvent, type TokenUsage, type ToolCallDelta } from '@/lib/sse'
import { api } from '@/lib/api'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { ModelEntry } from '@/lib/types'

interface Attachment {
  name: string
  size: number
  type: 'image' | 'file'
  mimeType: string
  dataUrl?: string
  content?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  reasoning?: string
  isThinking?: boolean
  isStreaming?: boolean
  isError?: boolean
  model?: string
  imageUrl?: string
  thinkingDurationSec?: number
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  attachments?: Attachment[]
  timestamp: string
}

interface ChatSession {
  id: string
  title: string
  model?: string
  systemPrompt?: string
  messageCount?: number
  createdAt: string
  updatedAt: string
}

function groupSessions(sessions: ChatSession[]): Array<{ label: string; items: ChatSession[] }> {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000
  const weekStart = todayStart - 7 * 86_400_000
  const groups: Record<string, ChatSession[]> = { Today: [], Yesterday: [], 'Previous 7 Days': [], Older: [] }
  for (const s of sessions) {
    const time = new Date(s.updatedAt || s.createdAt || Date.now()).getTime()
    if (time >= todayStart) groups.Today.push(s)
    else if (time >= yesterdayStart) groups.Yesterday.push(s)
    else if (time >= weekStart) groups['Previous 7 Days'].push(s)
    else groups.Older.push(s)
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }))
}

const MessageBubble = ({ message, onImageClick }: { message: ChatMessage; onImageClick: (url: string, alt?: string) => void }) => {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg rounded-br-sm border border-border bg-surface-2 px-3.5 py-2.5">
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {message.attachments.map((att, i) =>
                att.type === 'image' ? (
                  <img
                    key={i}
                    src={att.dataUrl}
                    alt={att.name}
                    className="h-16 w-16 cursor-pointer rounded border border-border object-cover"
                    onClick={() => att.dataUrl && onImageClick(att.dataUrl, att.name)}
                  />
                ) : (
                  <span key={i} className="rounded border border-border bg-surface px-2 py-1 font-mono text-[10px] text-muted">
                    {att.name}
                  </span>
                ),
              )}
            </div>
          )}
          <div className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">{message.content}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted">
        <Bot size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <ThinkingSection reasoning={message.reasoning} isThinking={message.isThinking} durationSec={message.thinkingDurationSec} />
        {message.content ? (
          <MarkdownRenderer content={message.content} onImageClick={(src) => onImageClick(String(src), '')} />
        ) : (
          message.isStreaming && !message.reasoning && <div className="py-1 text-xs text-subtle">…</div>
        )}
        {message.tool_calls?.map((tc) => (
          <ToolCallCard key={tc.id} toolCall={tc} />
        ))}
        {message.imageUrl && (
          <img
            src={message.imageUrl}
            alt="Generated"
            className="mt-2 max-h-80 cursor-pointer rounded-lg border border-border"
            onClick={() => onImageClick(message.imageUrl!, 'Generated image')}
          />
        )}
        {message.isError && <div className="mt-1 rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger">{message.content}</div>}
        {!message.isStreaming && message.content && !message.isError && (
          <button
            className="mt-1.5 text-subtle transition-colors hover:text-text"
            onClick={() => navigator.clipboard.writeText(message.content)}
            aria-label="Copy message"
          >
            <Copy size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

export default function ChatPage() {
  const [models, setModels] = useState<ModelEntry[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)

  const [chatMode, setChatMode] = useState<'chat' | 'image'>('chat')

  // Sessions
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editTitleValue, setEditTitleValue] = useState('')

  // Messages & stream
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [errorToast, setErrorToast] = useState('')
  const [isDragging, setIsDragging] = useState(false)

  const [lightboxImg, setLightboxImg] = useState<{ url: string; alt?: string } | null>(null)
  const [showConfig, setShowConfig] = useState(false)

  const mcpServers = useChatStore((s) => s.mcpServers)
  const activeMcpServerIds = useChatStore((s) => s.activeMcpServerIds)
  const getActiveMcpTools = useChatStore((s) => s.getActiveMcpTools)
  const skills = useChatStore((s) => s.skills)
  const customSkills = useChatStore((s) => s.customSkills)
  const allSkills = useMemo(() => [...skills, ...customSkills], [skills, customSkills])

  const browserToolDefs = useMemo(() => getToolDefinitions(), [])
  const slash = useSlashCommands({ mcpServers, browserTools: browserToolDefs, skills: allSkills })

  const abortControllerRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  const showToast = useCallback((msg: string) => {
    setErrorToast(msg)
    setTimeout(() => setErrorToast(''), 4000)
  }, [])

  const fetchSystemApiKey = useCallback(async (): Promise<string> => {
    try {
      const data = await api.get<unknown>('/api/keys')
      const keys = Array.isArray(data) ? (data as Array<{ key: string; isActive?: boolean }>) : ((data as { keys?: Array<{ key: string; isActive?: boolean }> })?.keys ?? [])
      const activeKey = keys.find((k) => k.isActive) ?? keys[0]
      return activeKey?.key ?? ''
    } catch (err) {
      console.error('Error fetching system API key:', err)
      return ''
    }
  }, [])

  const fetchModels = useCallback(async (key: string) => {
    let loaded: ModelEntry[] = []
    try {
      const data = await api.get<{ data: ModelEntry[] }>('/api/models')
      if (data.data?.length) loaded = data.data
    } catch {
      /* try next source */
    }
    if (loaded.length === 0) {
      try {
        const res = await fetch('/v1/models', { headers: key ? { Authorization: `Bearer ${key}` } : {} })
        if (res.ok) {
          const data = await res.json()
          if (data.data?.length) loaded = data.data
        }
      } catch {
        /* try next source */
      }
    }
    if (loaded.length === 0) {
      loaded = [
        { id: 'gpt-4o', object: 'model', owned_by: 'openai', created: 0 },
        { id: 'gpt-4o-mini', object: 'model', owned_by: 'openai', created: 0 },
        { id: 'claude-3-5-sonnet-20241022', object: 'model', owned_by: 'anthropic', created: 0 },
      ]
    }
    const seen = new Set<string>()
    const deduped = loaded.filter((m) => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })
    setModels(deduped)
    setSelectedModel((prev) => (prev && deduped.some((m) => m.id === prev) ? prev : deduped[0]?.id ?? ''))
  }, [])

  const appendMessageToStorage = useCallback(async (sessionId: string, msg: ChatMessage) => {
    try {
      await api.post(`/api/chat/sessions/${sessionId}/append`, msg)
    } catch {
      try {
        const key = `myairouter_msgs_${sessionId}`
        const current = JSON.parse(localStorage.getItem(key) ?? '[]')
        current.push(msg)
        localStorage.setItem(key, JSON.stringify(current))
      } catch {
        /* localStorage unavailable */
      }
    }
  }, [])

  const autoGenerateTitle = useCallback(
    async (sessionId: string, promptText: string) => {
      const words = promptText.trim().replace(/\n+/g, ' ').split(' ')
      let fallbackTitle = words.slice(0, 5).join(' ')
      if (fallbackTitle.length > 35) fallbackTitle = `${fallbackTitle.slice(0, 32)}…`
      fallbackTitle = fallbackTitle.charAt(0).toUpperCase() + fallbackTitle.slice(1)

      setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title: fallbackTitle } : s)))
      try {
        await api.patch(`/api/chat/sessions/${sessionId}`, { title: fallbackTitle })
      } catch {
        /* non-fatal */
      }
    },
    [],
  )

  const handleNewChat = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsStreaming(false)
    }
    const newId = `session-${Date.now()}`
    const newSession: ChatSession = {
      id: newId,
      title: 'New Chat',
      model: selectedModel,
      systemPrompt,
      messageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setActiveSessionId(newId)
    setMessages([])
    setAttachments([])
    setInput('')
    try {
      const created = await api.post<ChatSession>('/api/chat/sessions', newSession)
      setSessions((prev) => [created ?? newSession, ...prev.filter((s) => s.id !== newId)])
    } catch {
      setSessions((prev) => [newSession, ...prev])
    }
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [selectedModel, systemPrompt])

  const selectSession = useCallback(async (id: string) => {
    setActiveSessionId(id)
    setMessages([])
    try {
      const data = await api.get<{ session: ChatSession; messages: ChatMessage[] }>(`/api/chat/sessions/${id}`)
      setMessages(data.messages ?? [])
      if (data.session?.model) setSelectedModel(data.session.model)
      if (data.session?.systemPrompt) setSystemPrompt(data.session.systemPrompt)
    } catch {
      const stored = localStorage.getItem(`myairouter_msgs_${id}`)
      if (stored) {
        try {
          setMessages(JSON.parse(stored))
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.get<{ sessions: ChatSession[] }>('/api/chat/sessions')
      const list = data.sessions ?? []
      setSessions(list)
      if (list.length > 0) selectSession(list[0].id)
      else handleNewChat()
    } catch {
      handleNewChat()
    }
  }, [selectSession, handleNewChat])

  useEffect(() => {
    async function init() {
      const key = await fetchSystemApiKey()
      await fetchModels(key)
      await loadSessions()
      useChatStore.getState().reconnectAll()
    }
    init()
  }, [fetchSystemApiKey, fetchModels, loadSessions])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isStreaming) abortControllerRef.current?.abort()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isStreaming])

  const handleModelChange = (newModel: string) => {
    setSelectedModel(newModel)
    if (activeSessionId) {
      setSessions((prev) => prev.map((s) => (s.id === activeSessionId ? { ...s, model: newModel } : s)))
      api.patch(`/api/chat/sessions/${activeSessionId}`, { model: newModel }).catch(() => {})
    }
  }

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (!confirm('Delete this chat session?')) return
    api.del(`/api/chat/sessions/${id}`).catch(() => {})
    const remaining = sessions.filter((s) => s.id !== id)
    setSessions(remaining)
    localStorage.removeItem(`myairouter_msgs_${id}`)
    if (activeSessionId === id) {
      if (remaining.length > 0) selectSession(remaining[0].id)
      else handleNewChat()
    }
  }

  const handleSaveRename = async (id: string) => {
    if (!editTitleValue.trim()) {
      setEditingTitleId(null)
      return
    }
    const newTitle = editTitleValue.trim()
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: newTitle } : s)))
    setEditingTitleId(null)
    try {
      await api.patch(`/api/chat/sessions/${id}`, { title: newTitle })
    } catch {
      /* non-fatal */
    }
  }

  const addFiles = (files: File[]) => {
    const MAX_SIZE = 5 * 1024 * 1024
    for (const file of files) {
      if (file.size > MAX_SIZE) {
        showToast(`"${file.name}" exceeds the 5MB limit.`)
        continue
      }
      const reader = new FileReader()
      if (file.type.startsWith('image/')) {
        reader.onload = (event) =>
          setAttachments((prev) => [...prev, { name: file.name, size: file.size, type: 'image', mimeType: file.type, dataUrl: String(event.target?.result) }])
        reader.readAsDataURL(file)
      } else {
        reader.onload = (event) =>
          setAttachments((prev) => [...prev, { name: file.name, size: file.size, type: 'file', mimeType: file.type, content: String(event.target?.result) }])
        reader.readAsText(file)
      }
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData?.files.length) {
      const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
      if (images.length > 0) {
        e.preventDefault()
        addFiles(images)
      }
    }
  }

  const mergeToolCallDeltas = (acc: ChatMessage['tool_calls'], deltas: ToolCallDelta[]): ChatMessage['tool_calls'] => {
    const list = [...(acc ?? [])]
    for (const d of deltas) {
      const idx = list.findIndex((tc) => tc.id === d.id)
      if (idx === -1 && d.name) {
        list.push({ id: d.id ?? `call_${Date.now()}`, type: 'function', function: { name: d.name, arguments: d.argumentsDelta ?? '' } })
      } else if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          function: {
            name: (d.name ? list[idx].function.name + d.name : list[idx].function.name) || '',
            arguments: (list[idx].function.arguments ?? '') + (d.argumentsDelta ?? ''),
          },
        }
      }
    }
    return list
  }

  const runStream = useCallback(
    async (sessionId: string, apiMessages: Array<Record<string, unknown>>, assistantIndex: number, isFirstAssistant: boolean) => {
      const controller = new AbortController()
      abortControllerRef.current = controller
      const thinkingStart = Date.now()
      let accumulatedContent = ''
      let accumulatedReasoning = ''
      let toolCalls: ChatMessage['tool_calls'] = []
      let usage: TokenUsage | null = null
      let thinkingDurationSec = 0

      try {
        const result = await streamChatCompletion(
          { model: selectedModel, messages: apiMessages, max_tokens: 16384 },
          {
            signal: controller.signal,
            onEvent: (event: StreamEvent) => {
              if (event.reasoning) {
                accumulatedReasoning += event.reasoning
                thinkingDurationSec = (Date.now() - thinkingStart) / 1000
              }
              if (event.content) accumulatedContent += event.content
              if (event.toolCalls) toolCalls = mergeToolCallDeltas(toolCalls, event.toolCalls)
              if (event.usage) usage = event.usage
              setMessages((prev) => {
                const updated = [...prev]
                if (updated[assistantIndex]) {
                  updated[assistantIndex] = {
                    ...updated[assistantIndex],
                    content: accumulatedContent,
                    reasoning: accumulatedReasoning,
                    thinkingDurationSec,
                    isThinking: Boolean(event.reasoning),
                  }
                }
                return updated
              })
            },
          },
        )

        accumulatedContent = result.content
        accumulatedReasoning = result.reasoning
        usage = result.usage ?? usage

        const finalMsg: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: accumulatedContent || (toolCalls.length > 0 ? '' : '(empty response)'),
          reasoning: accumulatedReasoning,
          thinkingDurationSec,
          isThinking: false,
          isStreaming: false,
          model: selectedModel,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          timestamp: new Date().toISOString(),
        }
        setMessages((prev) => {
          const updated = [...prev]
          updated[assistantIndex] = finalMsg
          return updated
        })
        void isFirstAssistant
        await appendMessageToStorage(sessionId, finalMsg)
        return { finalMsg, usage }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return null
        setMessages((prev) => {
          const updated = [...prev]
          updated[assistantIndex] = {
            role: 'assistant',
            id: `msg-${Date.now()}`,
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
            isStreaming: false,
            timestamp: new Date().toISOString(),
          }
          return updated
        })
        return null
      }
    },
    [selectedModel, appendMessageToStorage],
  )

  const handleSend = async (customPrompt?: string) => {
    const textToSend = customPrompt ?? input
    if ((!textToSend.trim() && attachments.length === 0) || isStreaming) return
    if (!selectedModel) {
      showToast('Please select a model first')
      return
    }

    let currSessionId = activeSessionId ?? `session-${Date.now()}`
    if (!activeSessionId) setActiveSessionId(currSessionId)

    // Slash commands
    if (textToSend.trim().startsWith('/')) {
      const parsed = parseSlashCommand(textToSend.trim())
      if (parsed?.type === 'builtin') {
        if (parsed.command === 'clear') {
          setMessages([])
          setInput('')
          return
        }
        if (parsed.command === 'export') {
          const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `chat-export-${Date.now()}.json`
          a.click()
          URL.revokeObjectURL(url)
          setInput('')
          return
        }
        if (parsed.command === 'time') {
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}`,
              role: 'assistant',
              content: `Current time: ${new Date().toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
              timestamp: new Date().toISOString(),
            },
          ])
          setInput('')
          return
        }
        if (parsed.command === 'image') {
          setChatMode('image')
          await handleGenerateImage(parsed.args)
          return
        }
      }
      if (parsed?.type === 'tool') {
        try {
          const result = await executeTool(parsed.tool, parsed.args ? JSON.parse(parsed.args) : {})
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}`,
              role: 'assistant',
              content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
              timestamp: new Date().toISOString(),
            },
          ])
        } catch (e) {
          showToast(`Tool error: ${e instanceof Error ? e.message : String(e)}`)
        }
        setInput('')
        return
      }
      if (parsed?.type === 'mcp') {
        const activeTools = getActiveMcpTools()
        const mcpTool = activeTools.find((t) => t._serverName === parsed.server && t.name === parsed.tool)
        if (mcpTool) {
          try {
            const result = await useChatStore.getState().callMcpTool(mcpTool._serverId, parsed.tool, parsed.args ? JSON.parse(parsed.args) : {})
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now()}`,
                role: 'assistant',
                content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                timestamp: new Date().toISOString(),
              },
            ])
          } catch (e) {
            showToast(`MCP tool error: ${e instanceof Error ? e.message : String(e)}`)
          }
        } else {
          showToast(`MCP tool not found: ${parsed.server}:${parsed.tool}`)
        }
        setInput('')
        return
      }
      if (parsed?.type === 'skill') {
        const all = useChatStore.getState().getAllSkills()
        const skill = all.find((s) => s.id === parsed.skill)
        if (skill?.content) {
          setInput(`[Skill: ${skill.name}]\n${skill.content}\n[/Skill]\n\n${parsed.args || ''}`)
          showToast(`Skill "${skill.name}" loaded`)
        } else {
          try {
            const res = await fetch(`/skills/${parsed.skill}/SKILL.md`)
            if (res.ok) {
              const skillContent = await res.text()
              setInput(`[Skill: ${parsed.skill}]\n${skillContent}\n[/Skill]\n\n${parsed.args || ''}`)
              showToast('Skill loaded')
            } else {
              showToast(`Skill not found: ${parsed.skill}`)
            }
          } catch (e) {
            showToast(`Skill error: ${e instanceof Error ? e.message : String(e)}`)
          }
        }
        return
      }
    }

    if (chatMode === 'image' || textToSend.trim().startsWith('/image ')) {
      await handleGenerateImage(textToSend.replace(/^\/image\s*/, ''))
      return
    }

    let finalPrompt = textToSend.trim()
    for (const file of attachments.filter((a) => a.type === 'file')) {
      finalPrompt = `[Attached Document: ${file.name} (${(file.size / 1024).toFixed(1)} KB)]\n\`\`\`\n${file.content}\n\`\`\`\n\n${finalPrompt}`
    }

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: finalPrompt,
      attachments: [...attachments],
      timestamp: new Date().toISOString(),
    }

    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setAttachments([])
    setIsStreaming(true)

    appendMessageToStorage(currSessionId, userMsg)
    if (messages.length === 0) autoGenerateTitle(currSessionId, textToSend)

    const apiMessages: Array<Record<string, unknown>> = []
    if (systemPrompt.trim()) apiMessages.push({ role: 'system', content: systemPrompt.trim() })
    for (const m of newMessages.slice(-40)) {
      if (m.role === 'assistant' && (!m.content || m.content === '(empty response)') && !m.tool_calls) continue
      const images = (m.attachments ?? []).filter((a) => a.type === 'image')
      if (images.length > 0) {
        const parts: Array<Record<string, unknown>> = [{ type: 'text', text: m.content || 'Please analyze this image.' }]
        for (const img of images) parts.push({ type: 'image_url', image_url: { url: img.dataUrl } })
        apiMessages.push({ role: m.role, content: parts })
      } else {
        apiMessages.push({ role: m.role, content: m.content })
      }
    }

    const assistantIndex = newMessages.length
    setMessages([...newMessages, { id: `msg-${Date.now() + 1}`, role: 'assistant', content: '', reasoning: '', isStreaming: true, model: selectedModel, timestamp: new Date().toISOString() }])

    const outcome = await runStream(currSessionId, apiMessages, assistantIndex, messages.length === 0)
    setIsStreaming(false)
    abortControllerRef.current = null
    if (!outcome) return

    const { finalMsg } = outcome

    // Second round for tool results
    if (finalMsg.tool_calls && finalMsg.tool_calls.length > 0 && finalMsg.tool_calls.length <= 5) {
      const toolResults: Array<{ role: 'tool'; tool_call_id: string; content: string }> = []
      for (const tc of finalMsg.tool_calls) {
        try {
          const args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
          const result = await executeTool(tc.function.name, args)
          toolResults.push({ role: 'tool', tool_call_id: tc.id, content: typeof result === 'string' ? result : JSON.stringify(result) })
        } catch (e) {
          toolResults.push({ role: 'tool', tool_call_id: tc.id, content: `Error: ${e instanceof Error ? e.message : String(e)}` })
        }
      }

      const updatedMessages = [...newMessages, finalMsg, ...toolResults.map((t) => ({ role: 'tool', content: t.content, tool_call_id: t.tool_call_id, id: `tool-${t.tool_call_id}`, timestamp: new Date().toISOString() }) as ChatMessage)]
      setMessages((prev) => [...prev.slice(0, assistantIndex), finalMsg, ...updatedMessages.slice(newMessages.length + 1)])

      const toolApiMessages: Array<Record<string, unknown>> = []
      if (systemPrompt.trim()) toolApiMessages.push({ role: 'system', content: systemPrompt.trim() })
      for (const m of updatedMessages) {
        if (m.role === 'tool') {
          toolApiMessages.push({ role: 'tool', content: m.content, tool_call_id: (m as unknown as { tool_call_id: string }).tool_call_id })
        } else if (m.role !== 'assistant' || m.tool_calls) {
          toolApiMessages.push({ role: m.role, content: m.content })
        }
      }

      const toolAssistantIndex = updatedMessages.length
      setIsStreaming(true)
      setMessages((prev) => [...prev, { id: `msg-${Date.now() + 2}`, role: 'assistant', content: '', isStreaming: true, model: selectedModel, timestamp: new Date().toISOString() }])
      const toolOutcome = await runStream(currSessionId, toolApiMessages, toolAssistantIndex, false)
      setIsStreaming(false)
      abortControllerRef.current = null
      void toolOutcome
    }
  }

  const handleGenerateImage = async (prompt: string) => {
    const cleanPrompt = prompt.trim()
    if (!cleanPrompt) return

    const currSessionId = activeSessionId ?? `session-${Date.now()}`
    if (!activeSessionId) setActiveSessionId(currSessionId)

    const userMsg: ChatMessage = { id: `msg-${Date.now()}`, role: 'user', content: `Generate image: "${cleanPrompt}"`, timestamp: new Date().toISOString() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setIsStreaming(true)

    appendMessageToStorage(currSessionId, userMsg)
    if (messages.length === 0) autoGenerateTitle(currSessionId, cleanPrompt)

    const assistantIndex = newMessages.length
    setMessages([...newMessages, { id: `msg-${Date.now() + 1}`, role: 'assistant', content: 'Generating image…', isStreaming: true, timestamp: new Date().toISOString() }])

    try {
      const data = await api.post<{ data?: Array<{ url?: string }> }>('/v1/images/generations', { prompt: cleanPrompt, model: selectedModel, size: '1024x1024' })
      const imageUrl = data.data?.[0]?.url
      if (!imageUrl) throw new Error('No image URL returned by generator')

      const finalMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `Here is your generated image for **"${cleanPrompt}"**:\n\n![${cleanPrompt}](${imageUrl})`,
        imageUrl,
        isStreaming: false,
        model: selectedModel,
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => {
        const updated = [...prev]
        updated[assistantIndex] = finalMsg
        return updated
      })
      appendMessageToStorage(currSessionId, finalMsg)
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev]
        updated[assistantIndex] = {
          role: 'assistant',
          id: `msg-${Date.now()}`,
          content: `Image generation failed: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
          isStreaming: false,
          timestamp: new Date().toISOString(),
        }
        return updated
      })
    } finally {
      setIsStreaming(false)
    }
  }

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions
    const q = searchQuery.toLowerCase()
    return sessions.filter((s) => (s.title ?? '').toLowerCase().includes(q))
  }, [sessions, searchQuery])

  const grouped = useMemo(() => groupSessions(filteredSessions), [filteredSessions])

  const composerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const slashResult = slash.handleKeyDown(e)
    if (typeof slashResult === 'object' && slashResult !== null && 'label' in slashResult) {
      setInput(slash.selectCommand(slashResult))
      return
    }
    if (slashResult === true) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div
      className="relative flex h-[calc(100vh-3rem)] overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        if (e.dataTransfer.files.length) addFiles(Array.from(e.dataTransfer.files))
      }}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-accent bg-accent-subtle text-accent">
          <Upload size={40} />
          <span className="text-sm font-medium">Drop files to attach (max 5MB)</span>
        </div>
      )}

      {lightboxImg && <ImageLightbox src={lightboxImg.url} alt={lightboxImg.alt} onClose={() => setLightboxImg(null)} />}
      {showConfig && <ConfigModal isOpen onClose={() => setShowConfig(false)} />}

      {errorToast && (
        <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2 rounded-md bg-danger px-4 py-2 text-[13px] font-medium text-on-accent">{errorToast}</div>
      )}

      {/* Sessions sidebar */}
      <div className={cn('flex flex-col border-r border-border bg-surface transition-[width] duration-200', isSidebarOpen ? 'w-64' : 'w-0 overflow-hidden')}>
        <div className="flex flex-col gap-2 p-2.5">
          <div className="flex gap-1.5">
            <Button variant="primary" size="sm" className="flex-1" onClick={handleNewChat}>
              <MessageSquarePlus size={13} /> New chat
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowConfig(true)} aria-label="Chat configuration">
              <Settings2 size={14} />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIsSidebarOpen(false)} aria-label="Hide sessions">
              <PanelLeftClose size={14} />
            </Button>
          </div>
          <input
            placeholder="Search chats…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 rounded-md border border-border bg-bg px-2.5 text-xs outline-none placeholder:text-subtle focus:border-accent"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {grouped.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-subtle">{group.label}</div>
              {group.items.map((s) => (
                <div
                  key={s.id}
                  onClick={() => selectSession(s.id)}
                  className={cn(
                    'group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                    activeSessionId === s.id ? 'bg-accent-subtle text-accent' : 'text-muted hover:bg-surface-2 hover:text-text',
                  )}
                >
                  {editingTitleId === s.id ? (
                    <input
                      autoFocus
                      value={editTitleValue}
                      onChange={(e) => setEditTitleValue(e.target.value)}
                      onBlur={() => handleSaveRename(s.id)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveRename(s.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-full rounded border border-border bg-bg px-1 text-xs outline-none"
                    />
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">{s.title || 'Untitled'}</span>
                      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                        <button
                          className="p-0.5 text-subtle hover:text-text"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingTitleId(s.id)
                            setEditTitleValue(s.title)
                          }}
                          aria-label="Rename"
                        >
                          <Square size={10} />
                        </button>
                        <button
                          className="p-0.5 text-subtle hover:text-text"
                          onClick={(e) => {
                            e.stopPropagation()
                            window.open(`/api/chat/sessions/${s.id}/export`, '_blank')
                          }}
                          aria-label="Export session"
                        >
                          <Download size={11} />
                        </button>
                        <button className="p-0.5 text-subtle hover:text-danger" onClick={(e) => handleDeleteSession(e, s.id)} aria-label="Delete session">
                          <Trash2 size={11} />
                        </button>
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Main chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Chat header */}
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-3">
          <div className="flex items-center gap-2">
            {!isSidebarOpen && (
              <button className="text-muted hover:text-text" onClick={() => setIsSidebarOpen(true)} aria-label="Show sessions">
                <PanelLeftOpen size={15} />
              </button>
            )}
            <button
              onClick={() => setChatMode(chatMode === 'chat' ? 'image' : 'chat')}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
                chatMode === 'image' ? 'border-accent bg-accent-subtle text-accent' : 'border-border text-muted hover:text-text',
              )}
            >
              <ImageIcon size={12} />
              {chatMode === 'image' ? 'Image mode' : 'Image'}
            </button>
            <button
              onClick={() => setShowSystemPrompt((v) => !v)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
                showSystemPrompt ? 'border-accent bg-accent-subtle text-accent' : 'border-border text-muted hover:text-text',
              )}
              title={showSystemPrompt ? 'Hide system prompt' : 'Set a system prompt'}
            >
              <FileText size={12} />
              System
            </button>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className="h-8 max-w-64 rounded-md border border-border bg-bg px-2 text-xs outline-none focus:border-accent"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
            <button
              className="text-muted transition-colors hover:text-text"
              onClick={async () => {
                const key = await fetchSystemApiKey()
                await fetchModels(key)
              }}
              aria-label="Reload models"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        {/* System prompt editor */}
        {showSystemPrompt && (
          <div className="border-b border-border bg-surface px-3 py-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">System prompt</span>
              <button className="text-subtle hover:text-text" onClick={() => setShowSystemPrompt(false)} aria-label="Close system prompt">
                <X size={12} />
              </button>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful assistant…"
              rows={2}
              className="w-full resize-y rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs outline-none focus:border-accent"
            />
          </div>
        )}

        {/* Messages */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.length === 0 && (
              <div className="py-16 text-center">
                <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface text-muted">
                  <MessageSquarePlus size={20} />
                </span>
                <p className="text-sm font-medium text-text">Start a conversation</p>
                <p className="mt-1 text-xs text-muted">
                  Streaming chat with reasoning, attachments, slash commands and MCP tools. Requests pass straight through the gateway.
                </p>
                <button className="mt-3 text-xs text-accent hover:underline" onClick={() => setShowSystemPrompt(true)}>
                  + Set a system prompt
                </button>
              </div>
            )}
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} onImageClick={(url, alt) => setLightboxImg({ url, alt })} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-border bg-surface px-4 py-3">
          <div className="mx-auto max-w-3xl">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {attachments.map((att, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-muted">
                    {att.type === 'image' ? <ImageIcon size={10} /> : <Paperclip size={10} />}
                    {att.name}
                    <button onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))} className="text-subtle hover:text-danger" aria-label={`Remove ${att.name}`}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="relative rounded-lg border border-border bg-bg focus-within:border-accent">
              {slash.isOpen && (
                <SlashCommandPopup
                  commands={slash.filtered}
                  selectedIndex={slash.selectedIndex}
                  onSelect={(cmd) => setInput(slash.selectCommand(cmd))}
                />
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  slash.handleInput(e.target.value)
                }}
                onKeyDown={composerKeyDown}
                onPaste={handlePaste}
                placeholder={chatMode === 'image' ? 'Describe the image to generate…' : 'Send a message — / for commands'}
                rows={1}
                className="max-h-40 w-full resize-none bg-transparent px-3 py-2.5 pr-20 text-[13.5px] outline-none placeholder:text-subtle"
                style={{ height: 'auto' }}
                onInput={(e) => {
                  const t = e.currentTarget
                  t.style.height = 'auto'
                  t.style.height = `${Math.min(t.scrollHeight, 160)}px`
                }}
              />
              <div className="absolute bottom-2 right-2 flex items-center gap-1">
                <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); if (fileInputRef.current) fileInputRef.current.value = '' }} />
                <button className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-text" onClick={() => fileInputRef.current?.click()} aria-label="Attach files">
                  <Paperclip size={14} />
                </button>
                {isStreaming ? (
                  <button className="flex h-7 w-7 items-center justify-center rounded-md bg-danger text-on-accent" onClick={() => abortControllerRef.current?.abort()} aria-label="Stop">
                    <Square size={12} />
                  </button>
                ) : (
                  <button
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-40"
                    onClick={() => handleSend()}
                    disabled={!input.trim() && attachments.length === 0}
                    aria-label="Send"
                  >
                    <ArrowUp size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="mt-1.5 text-center text-[10px] text-subtle">
              Enter to send · Shift+Enter for newline · {activeMcpServerIds.length} MCP server(s) active
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
