import { Component, ReactNode, ErrorInfo } from 'react'
import { theme } from '../common/theme'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: (error: Error, resetError: () => void) => ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  name?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const boundaryName = this.props.name || 'Unknown'
    console.error(`[ErrorBoundary ${boundaryName}] Component error caught:`, error, errorInfo)
    
    this.setState({ errorInfo })
    
    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }
  }

  resetError = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    })
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.resetError)
      }

      return (
        <div 
          style={{
            backgroundColor: theme.colors.background.elevated,
            color: theme.colors.text.primary,
            padding: '2rem',
            borderRadius: '0.5rem',
            border: `1px solid ${theme.colors.border.default}`,
            margin: '1rem',
            fontFamily: 'monospace'
          }}
        >
          <h2 style={{ 
            fontSize: theme.fontSize.heading,
            color: theme.colors.accent.red.light,
            marginBottom: '1rem'
          }}>
            Something went wrong
          </h2>
          
          <p style={{ 
            fontSize: theme.fontSize.body,
            color: theme.colors.text.secondary,
            marginBottom: '1rem'
          }}>
            An unexpected error occurred in {this.props.name || 'this component'}.
          </p>
          
          <details style={{ marginBottom: '1rem' }}>
            <summary style={{ 
              cursor: 'pointer',
              fontSize: theme.fontSize.body,
              color: theme.colors.text.tertiary
            }}>
              Error details
            </summary>
            <pre style={{ 
              fontSize: theme.fontSize.caption,
              marginTop: '0.5rem',
              padding: '0.5rem',
              backgroundColor: theme.colors.background.secondary,
              borderRadius: '0.25rem',
              overflow: 'auto'
            }}>
              {this.state.error.toString()}
              {this.state.errorInfo && '\n\nComponent Stack:\n' + this.state.errorInfo.componentStack}
            </pre>
          </details>
          
          <button
            onClick={this.resetError}
            style={{
              padding: '0.5rem 1rem',
              fontSize: theme.fontSize.button,
              backgroundColor: theme.colors.accent.blue.DEFAULT,
              color: theme.colors.text.inverse,
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.colors.accent.blue.dark
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = theme.colors.accent.blue.DEFAULT
            }}
          >
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary