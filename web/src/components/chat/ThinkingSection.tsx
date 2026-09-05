import { useEffect, useState } from 'react'
import { Brain, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

interface ThinkingSectionProps {
  reasoning?: string
  isThinking?: boolean
  durationSec?: number
}

export default function ThinkingSection({ reasoning, isThinking, durationSec }: ThinkingSectionProps) {
  const [isOpen, setIsOpen] = useState(Boolean(isThinking))

  useEffect(() => {
    if (isThinking) setIsOpen(true)
  }, [isThinking])

  if (!reasoning && !isThinking) return null

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border">
      <button onClick={() => setIsOpen(!isOpen)} className="flex w-full items-center justify-between px-3 py-1.5 text-xs">
        <span className={cn('flex items-center gap-2 font-mono', isThinking ? 'text-accent' : 'text-muted')}>
          {isThinking ? <Loader2 size={13} className="animate-spin" /> : <Brain size={13} />}
          {isThinking ? 'Thinking…' : `Thought for ${(durationSec ?? 0).toFixed(1)}s`}
        </span>
        <ChevronDown size={13} className={cn('text-muted transition-transform', isOpen && 'rotate-180')} />
      </button>
      {isOpen && (
        <div className="max-h-80 overflow-y-auto border-t border-border bg-surface-2 px-3.5 py-2.5 text-xs italic leading-relaxed text-muted">
          {reasoning || (isThinking ? 'Analyzing context and formulating response…' : '')}
        </div>
      )}
    </div>
  )
}
