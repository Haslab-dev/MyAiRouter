import { useState } from 'react'
import { ChevronDown, CheckCircle2, Loader2, Wrench } from 'lucide-react'
import { cn } from '@/lib/cn'

interface ToolCall {
  id: string
  function: { name?: string; arguments?: string }
}

interface ToolCallCardProps {
  toolCall: ToolCall
  result?: unknown
  isExecuting?: boolean
}

export default function ToolCallCard({ toolCall, result, isExecuting }: ToolCallCardProps) {
  const [isOpen, setIsOpen] = useState(false)
  const fn = toolCall.function ?? {}
  const argsStr = fn.arguments || '{}'

  let parsedArgs: unknown
  try {
    parsedArgs = JSON.parse(argsStr)
  } catch {
    parsedArgs = argsStr
  }

  const argsPreview =
    typeof parsedArgs === 'object' && parsedArgs !== null
      ? Object.entries(parsedArgs as Record<string, unknown>)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v.slice(0, 30)}"` : v}`)
          .join(' ')
      : String(parsedArgs)

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border">
      <button
        onClick={() => result && setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
      >
        {isExecuting ? <Loader2 size={13} className="animate-spin text-accent" /> : <CheckCircle2 size={13} className={result ? 'text-success' : 'text-subtle'} />}
        <Wrench size={12} className="text-accent" />
        <span className="font-mono font-semibold">{fn.name}</span>
        {argsPreview && <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{argsPreview}</span>}
        {isExecuting && <span className="ml-auto text-[11px] text-muted">Executing…</span>}
        {!isExecuting && result != null && <ChevronDown size={13} className={cn('ml-auto text-muted transition-transform', isOpen && 'rotate-180')} />}
      </button>
      {isOpen && result != null && (
        <div className="max-h-52 overflow-y-auto border-t border-border bg-surface-2 px-3 py-2">
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-muted">
            {typeof result === 'string' ? result : JSON.stringify(result, null, 2) as string}
          </pre>
        </div>
      )}
    </div>
  )
}
