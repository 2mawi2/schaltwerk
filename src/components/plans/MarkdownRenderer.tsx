import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { theme } from '../../common/theme'

interface MarkdownRendererProps {
  content: string
  className?: string
}

const customComponents: Partial<Components> = {
  h1: ({ children }) => (
    <h1 style={{
      fontSize: '2em',
      fontWeight: 'bold',
      marginTop: '0.67em',
      marginBottom: '0.67em',
      color: theme.colors.text.primary
    }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{
      fontSize: '1.5em',
      fontWeight: 'bold',
      marginTop: '0.83em',
      marginBottom: '0.83em',
      color: theme.colors.text.primary
    }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{
      fontSize: '1.17em',
      fontWeight: 'bold',
      marginTop: '1em',
      marginBottom: '1em',
      color: theme.colors.text.primary
    }}>
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 style={{
      fontSize: '1em',
      fontWeight: 'bold',
      marginTop: '1.33em',
      marginBottom: '1.33em',
      color: theme.colors.text.primary
    }}>
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 style={{
      fontSize: '0.83em',
      fontWeight: 'bold',
      marginTop: '1.67em',
      marginBottom: '1.67em',
      color: theme.colors.text.primary
    }}>
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 style={{
      fontSize: '0.67em',
      fontWeight: 'bold',
      marginTop: '2.33em',
      marginBottom: '2.33em',
      color: theme.colors.text.primary
    }}>
      {children}
    </h6>
  ),
  p: ({ children }) => (
    <p style={{
      marginTop: '1em',
      marginBottom: '1em',
      lineHeight: '1.6',
      color: theme.colors.text.primary
    }}>
      {children}
    </p>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: theme.colors.accent.blue.DEFAULT,
        textDecoration: 'underline'
      }}
    >
      {children}
    </a>
  ),
  code: ({ children, className }) => {
    const isInline = !className
    if (isInline) {
      return (
        <code style={{
          backgroundColor: theme.colors.background.elevated,
          color: theme.colors.accent.cyan.DEFAULT,
          padding: '2px 4px',
          borderRadius: '3px',
          fontSize: '0.9em',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
        }}>
          {children}
        </code>
      )
    }
    return (
      <code
        className={className}
        style={{
          display: 'block',
          backgroundColor: theme.colors.background.elevated,
          color: theme.colors.text.primary,
          padding: '12px',
          borderRadius: '4px',
          overflowX: 'auto',
          fontSize: '0.9em',
          lineHeight: '1.5',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'
        }}
      >
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre style={{
      marginTop: '1em',
      marginBottom: '1em',
      overflow: 'auto'
    }}>
      {children}
    </pre>
  ),
  ul: ({ children }) => (
    <ul style={{
      marginTop: '1em',
      marginBottom: '1em',
      paddingLeft: '2em',
      listStyleType: 'disc',
      color: theme.colors.text.primary
    }}>
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol style={{
      marginTop: '1em',
      marginBottom: '1em',
      paddingLeft: '2em',
      listStyleType: 'decimal',
      color: theme.colors.text.primary
    }}>
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li style={{
      marginTop: '0.25em',
      marginBottom: '0.25em',
      lineHeight: '1.6'
    }}>
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote style={{
      borderLeft: `3px solid ${theme.colors.border.default}`,
      paddingLeft: '1em',
      marginLeft: '0',
      marginTop: '1em',
      marginBottom: '1em',
      fontStyle: 'italic',
      color: theme.colors.text.secondary
    }}>
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr style={{
      border: 'none',
      borderTop: `1px solid ${theme.colors.border.subtle}`,
      marginTop: '2em',
      marginBottom: '2em'
    }} />
  ),
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', marginTop: '1em', marginBottom: '1em' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        color: theme.colors.text.primary
      }}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{
      borderBottom: `2px solid ${theme.colors.border.default}`
    }}>
      {children}
    </thead>
  ),
  tbody: ({ children }) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr style={{
      borderBottom: `1px solid ${theme.colors.border.subtle}`
    }}>
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <th style={{
      padding: '8px 12px',
      textAlign: 'left',
      fontWeight: 'bold',
      backgroundColor: theme.colors.background.secondary
    }}>
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{
      padding: '8px 12px'
    }}>
      {children}
    </td>
  ),
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = ''
}: MarkdownRendererProps) {
  return (
    <div
      className={`markdown-renderer ${className}`}
      style={{
        padding: '16px',
        overflowY: 'auto',
        height: '100%',
        backgroundColor: theme.colors.background.primary,
        color: theme.colors.text.primary,
        fontSize: '14px',
        lineHeight: '1.6'
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={customComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
