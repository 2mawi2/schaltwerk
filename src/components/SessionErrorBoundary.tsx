import React, { ReactNode } from 'react'
import ErrorBoundary from './ErrorBoundary'
import { theme } from '../common/theme'
import { VscRefresh, VscFolderOpened } from 'react-icons/vsc'
import { useTranslation } from '../common/i18n'

interface SessionErrorBoundaryProps {
  children: ReactNode
  sessionName?: string
}

const SessionErrorBoundary: React.FC<SessionErrorBoundaryProps> = ({
  children,
  sessionName
}) => {
  const { t } = useTranslation()
  const handleSessionError = (error: Error, resetError: () => void): ReactNode => {
    return (
      <div 
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--color-bg-secondary)',
          color: 'var(--color-text-primary)',
          padding: '2rem',
          boxSizing: 'border-box'
        }}
      >
        <VscFolderOpened 
          size={48} 
          color="var(--color-accent-amber-light)"
          style={{ marginBottom: '1rem' }}
        />
        
        <h3 style={{
          fontSize: theme.fontSize.heading,
          color: 'var(--color-text-primary)',
          marginBottom: '0.5rem',
          textAlign: 'center'
        }}>
          {t.sessionErrorBoundary.title}
        </h3>

        {sessionName && (
          <p style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-text-tertiary)',
            marginBottom: '1rem',
            textAlign: 'center'
          }}>
            {t.sessionErrorBoundary.session.replace('{sessionName}', sessionName)}
          </p>
        )}

        <p style={{
          fontSize: theme.fontSize.body,
          color: 'var(--color-text-secondary)',
          marginBottom: '1.5rem',
          textAlign: 'center',
          maxWidth: '400px'
        }}>
          {t.sessionErrorBoundary.description}
        </p>

        <details style={{
          marginBottom: '1.5rem',
          maxWidth: '400px',
          width: '100%'
        }}>
          <summary style={{
            cursor: 'pointer',
            fontSize: theme.fontSize.caption,
            color: 'var(--color-text-muted)'
          }}>
            {t.sessionErrorBoundary.errorDetails}
          </summary>
          <pre style={{ 
            fontSize: theme.fontSize.caption,
            marginTop: '0.5rem',
            padding: '0.5rem',
            backgroundColor: 'var(--color-bg-primary)',
            borderRadius: '0.25rem',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}>
            {error.message}
            {error.stack && '\n\nStack:\n' + error.stack}
          </pre>
        </details>
        
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={resetError}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              fontSize: theme.fontSize.button,
              backgroundColor: 'var(--color-accent-blue)',
              color: 'var(--color-text-inverse)',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-accent-blue-dark)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-accent-blue)'
            }}
          >
            <VscRefresh size={16} />
            {t.sessionErrorBoundary.retry}
          </button>

          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1rem',
              fontSize: theme.fontSize.button,
              backgroundColor: 'transparent',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-default)',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            {t.sessionErrorBoundary.refreshApp}
          </button>
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary 
      name={`Session ${sessionName || 'Provider'}`}
      fallback={handleSessionError}
    >
      {children}
    </ErrorBoundary>
  )
}

export default SessionErrorBoundary
