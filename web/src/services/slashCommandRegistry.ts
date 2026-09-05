import type { McpServer, Skill } from '@/stores/chatStore'

export interface SlashCommand {
  id: string
  label: string
  description?: string
  icon: string
  category: string
}

export const BUILT_IN_COMMANDS: SlashCommand[] = [
  { id: 'image', label: '/image', description: 'Generate an image from a prompt', icon: 'palette', category: 'Built-in' },
  { id: 'clear', label: '/clear', description: 'Clear the current conversation', icon: 'delete_sweep', category: 'Built-in' },
  { id: 'export', label: '/export', description: 'Export chat as JSON', icon: 'download', category: 'Built-in' },
  { id: 'time', label: '/time', description: 'Get current date and time', icon: 'schedule', category: 'Tool' },
]

export function buildSlashCommands(mcpServers: McpServer[] = [], browserTools: Array<{ function: { name: string; description: string } }> = [], skills: Skill[] = []): SlashCommand[] {
  const commands = [...BUILT_IN_COMMANDS]

  for (const tool of browserTools) {
    if (!commands.find((c) => c.id === `tool:${tool.function.name}`)) {
      commands.push({
        id: `tool:${tool.function.name}`,
        label: `/tool:${tool.function.name}`,
        description: tool.function.description,
        icon: 'build',
        category: 'Tool',
      })
    }
  }

  for (const server of mcpServers) {
    if (!server.tools) continue
    for (const tool of server.tools) {
      commands.push({
        id: `mcp:${server.name}:${tool.name}`,
        label: `/mcp:${server.name} ${tool.name}`,
        description: tool.description || `MCP tool from ${server.name}`,
        icon: 'extension',
        category: `MCP: ${server.name}`,
      })
    }
  }

  for (const skill of skills) {
    commands.push({
      id: `skill:${skill.id}`,
      label: `/skill:${skill.id}`,
      description: skill.description || `Load ${skill.name} as context`,
      icon: 'conversion_path',
      category: 'Skill',
    })
  }

  return commands
}

export type ParsedCommand =
  | { type: 'builtin'; command: string; args: string }
  | { type: 'tool'; tool: string; args: string }
  | { type: 'mcp'; server: string; tool: string; args: string }
  | { type: 'skill'; skill: string; args: string }

export function parseSlashCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null

  const spaceIdx = trimmed.indexOf(' ')
  const cmdPart = spaceIdx > 0 ? trimmed.slice(1, spaceIdx) : trimmed.slice(1)
  const args = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : ''

  if (cmdPart.startsWith('mcp:')) {
    const parts = cmdPart.slice(4).split(' ')
    return { type: 'mcp', server: parts[0], tool: parts[1] ?? '', args }
  }
  if (cmdPart.startsWith('tool:')) {
    return { type: 'tool', tool: cmdPart.slice(5), args }
  }
  if (cmdPart.startsWith('skill:')) {
    return { type: 'skill', skill: cmdPart.slice(6), args }
  }
  return { type: 'builtin', command: cmdPart, args }
}
