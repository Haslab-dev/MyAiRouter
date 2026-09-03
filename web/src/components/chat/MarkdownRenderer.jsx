import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';

export default function MarkdownRenderer({ content, onImageClick }) {
  if (!content) return null;

  return (
    <div className="markdown-body" style={{ lineHeight: '1.6', fontSize: '14px' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }) {
            if (inline) {
              return (
                <code
                  className={className}
                  style={{
                    padding: '2px 6px',
                    borderRadius: '4px',
                    background: 'rgba(255,255,255,0.06)',
                    fontSize: '13px',
                    fontFamily: 'var(--font-mono)',
                  }}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            const match = /language-(\w+)/.exec(className || '');
            const lang = match ? match[1] : 'text';
            return <CodeBlock language={lang}>{children}</CodeBlock>;
          },
          img({ src, alt, ...props }) {
            return (
              <span
                onClick={() => onImageClick?.(src, alt)}
                style={{ cursor: 'pointer', display: 'inline-block', margin: '8px 0' }}
              >
                <img
                  src={src}
                  alt={alt}
                  style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '8px', display: 'block' }}
                  {...props}
                />
              </span>
            );
          },
          table({ children }) {
            return (
              <div style={{ overflowX: 'auto', margin: '12px 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th style={{
                padding: '8px 12px',
                borderBottom: '2px solid var(--border-color)',
                textAlign: 'left',
                fontWeight: 600,
                fontSize: '13px',
                color: 'var(--text-main)'
              }}>
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td style={{
                padding: '8px 12px',
                borderBottom: '1px solid var(--border-color)',
                fontSize: '13px'
              }}>
                {children}
              </td>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote style={{
                borderLeft: '3px solid var(--color-primary)',
                paddingLeft: '12px',
                margin: '12px 0',
                color: 'var(--text-muted)',
                fontStyle: 'italic'
              }}>
                {children}
              </blockquote>
            );
          },
          h1({ children }) {
            return <h1 style={{ fontSize: '22px', fontWeight: 700, margin: '16px 0 8px', color: 'var(--text-main)' }}>{children}</h1>;
          },
          h2({ children }) {
            return <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '14px 0 6px', color: 'var(--text-main)' }}>{children}</h2>;
          },
          h3({ children }) {
            return <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '12px 0 4px', color: 'var(--text-main)' }}>{children}</h3>;
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
                onClick={e => e.stopPropagation()}
              >
                {children}
              </a>
            );
          },
          ul({ children }) {
            return <ul style={{ paddingLeft: '20px', margin: '8px 0' }}>{children}</ul>;
          },
          ol({ children }) {
            return <ol style={{ paddingLeft: '20px', margin: '8px 0' }}>{children}</ol>;
          },
          li({ children }) {
            return <li style={{ margin: '4px 0' }}>{children}</li>;
          },
          p({ children }) {
            return <p style={{ margin: '8px 0' }}>{children}</p>;
          },
          hr() {
            return <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '16px 0' }} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
