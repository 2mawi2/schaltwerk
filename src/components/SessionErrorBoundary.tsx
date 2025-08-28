import React, { ReactNode } from 'react'
import ErrorBoundary from './ErrorBoundary'
import { theme } from '../common/theme'
import { VscRefresh, VscFolderOpened } from 'react-icons/vsc'

interface SessionErrorBoundaryProps {
  children: ReactNode
  sessionName?: string
}

const SessionErrorBoundary: React.FC<SessionErrorBoundaryProps> = ({ 
  children, 
  sessionName
}) => {
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
          backgroundColor: theme.colors.background.secondary,
          color: theme.colors.text.primary,
          padding: '2rem',
          boxSizing: 'border-box'
        }}
      >
        <VscFolderOpened 
          size={48} 
          color={theme.colors.accent.amber.light}
          style={{ marginBottom: '1rem' }}
        />
        
        <h3 style={{ 
          fontSize: theme.fontSize.heading,
          color: theme.colors.text.primary,
          marginBottom: '0.5rem',
          textAlign: 'center'
        }}>
          Session Error
        </h3>
        
        {sessionName && (
          <p style={{ 
            fontSize: theme.fontSize.caption,
            color: theme.colors.text.tertiary,
            marginBottom: '1rem',
            textAlign: 'center'
          }}>
            Session: {sessionName}
          </p>
        )}
        
        <p style={{ 
          fontSize: theme.fontSize.body,
          color: theme.colors.text.secondary,
          marginBottom: '1.5rem',
          textAlign: 'center',
          maxWidth: '400px'
        }}>
          Failed to load session data. This might be due to a corrupted session state or network issue.
        </p>

        <details style={{ 
          marginBottom: '1.5rem',
          maxWidth: '400px',
          width: '100%'
        }}>
          <summary style={{ 
            cursor: 'pointer',
            fontSize: theme.fontSize.caption,
            color: theme.colors.text.muted
          }}>
            Error details
          </summary>
          <pre style={{ 
            fontSize: theme.fontSize.caption,
            marginTop: '0.5rem',
            padding: '0.5rem',
            backgroundColor: theme.colors.background.primary,
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
              backgroundColor: theme.colors.accent.blue.DEFAULT,
              color: theme.colors.text.inverse,
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.colors.accent.blue.dark
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = theme.colors.accent.blue.DEFAULT
            }}
          >
            <VscRefresh size={16} />
            Retry
          </button>
          
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1rem',
              fontSize: theme.fontSize.button,
              backgroundColor: 'transparent',
              color: theme.colors.text.secondary,
              border: `1px solid ${theme.colors.border.default}`,
              borderRadius: '0.25rem',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.colors.background.hover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            Refresh App
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