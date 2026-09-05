import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CodeBlock from './CodeBlock'

interface MarkdownRendererProps {
  content?: string
  onImageClick?: (src: unknown, alt?: string) => void
}

export default function MarkdownRenderer({ content, onImageClick }: MarkdownRendererProps) {
  if (!content) return null

  return (
    <div className="leading-relaxed text-[14px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? '')
            const isBlock = Boolean(match) || String(children).includes('\n')
            if (!isBlock) {
              return (
                <code className={`rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] ${className ?? ''}`} {...props}>
                  {children}
                </code>
              )
            }
            return (
              <CodeBlock language={match?.[1] ?? 'text'}>{children}</CodeBlock>
            )
          },
          img({ src, alt }) {
            return (
              <span className="my-2 inline-block cursor-pointer" onClick={() => onImageClick?.(src, alt)}>
                <img src={typeof src === 'string' ? src : ''} alt={alt ?? ''} className="block max-h-96 max-w-full rounded-md" />
              </span>
            )
          },
          table({ children }) {
            return (
              <div className="my-3 overflow-x-auto">
                <table className="w-full border-collapse">{children}</table>
              </div>
            )
          },
          th({ children }) {
            return <th className="border-b-2 border-border px-3 py-1.5 text-left text-xs font-semibold">{children}</th>
          },
          td({ children }) {
            return <td className="border-b border-border px-3 py-1.5 text-[13px]">{children}</td>
          },
          blockquote({ children }) {
            return <blockquote className="my-3 border-l-2 border-accent pl-3 text-muted italic">{children}</blockquote>
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                {children}
              </a>
            )
          },
          h1({ children }) {
            return <h1 className="mb-2 mt-4 text-xl font-semibold">{children}</h1>
          },
          h2({ children }) {
            return <h2 className="mb-1.5 mt-3.5 text-base font-semibold">{children}</h2>
          },
          h3({ children }) {
            return <h3 className="mb-1 mt-3 text-sm font-semibold">{children}</h3>
          },
          p({ children }) {
            return <p className="my-2">{children}</p>
          },
          ul({ children }) {
            return <ul className="my-2 list-disc pl-5">{children}</ul>
          },
          ol({ children }) {
            return <ol className="my-2 list-decimal pl-5">{children}</ol>
          },
          li({ children }) {
            return <li className="my-1">{children}</li>
          },
          hr() {
            return <hr className="my-4 border-border" />
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
