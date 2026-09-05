import type { SlashCommand } from '@/services/slashCommandRegistry'
import { cn } from '@/lib/cn'

interface SlashCommandPopupProps {
  commands: SlashCommand[]
  selectedIndex: number
  onSelect: (command: SlashCommand) => void
}

export default function SlashCommandPopup({ commands, selectedIndex, onSelect }: SlashCommandPopupProps) {
  if (!commands.length) return null

  return (
    <div className="absolute bottom-full left-0 right-0 z-20 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface shadow-md">
      {commands.map((cmd, i) => (
        <button
          key={cmd.id}
          onClick={() => onSelect(cmd)}
          className={cn('flex w-full items-center gap-3 px-3 py-2 text-left transition-colors', i === selectedIndex ? 'bg-accent-subtle' : 'hover:bg-surface-2')}
        >
          <code className="shrink-0 font-mono text-xs font-semibold text-text">{cmd.label}</code>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{cmd.description}</span>
          <span className="shrink-0 rounded bg-surface-2 px-1.5 py-px text-[10px] text-subtle">{cmd.category}</span>
        </button>
      ))}
    </div>
  )
}
