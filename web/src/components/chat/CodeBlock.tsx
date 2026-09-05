import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

interface CodeBlockProps {
  language?: string
  children: React.ReactNode
}

export default function CodeBlock({ language = 'text', children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(String(children))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="my-2.5 overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border bg-surface-2 px-3 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-subtle">{language}</span>
        <button onClick={copy} className="flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-text">
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-96 overflow-auto bg-bg p-3 font-mono text-xs leading-relaxed">{children}</pre>
    </div>
  )
}
