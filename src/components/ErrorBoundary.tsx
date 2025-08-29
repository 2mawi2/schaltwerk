import { Component, ReactNode, ErrorInfo } from 'react'
import { theme } from '../common/theme'
import { AsciiBuilderLogo } from './home/AsciiBuilderLogo'

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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 max-w-lg w-full mx-4">
            {/* Header with animated text */}
            <div className="text-center mb-6">
              <div className="mb-4">
                <AsciiBuilderLogo
                  asciiArt={`╦ ╦╦ ╦╔═╗╔═╗╔═╗╔═╗
║║║╠═╣║ ║║ ║╠═╝╚═╗
╚╩╝╩ ╩╚═╝╚═╝╩  ╚═╝`}
                  colorClassName="text-cyan-400"
                  idleMode="artifact+pulse"
                  groupOrder="center-out"
                  fallDurationMs={400}
                  settleDurationMs={600}
                  groupGapMs={80}
                  idleArtifactMagnitude={2.8}
                  idleArtifactMinDelayMs={1200}
                  idleArtifactMaxDelayMs={2000}
                />
              </div>
              
              <h2 className="text-xl font-semibold mb-2 text-slate-100">
                Well, that's unexpected
              </h2>
              
              <p className="text-sm text-slate-300">
                Don't worry - this happens sometimes. Let's get things back on track.
              </p>
            </div>

            {/* Error details section */}
            <details className="mb-6 bg-slate-800 border border-slate-700 rounded-md">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-300 hover:text-slate-100 hover:bg-slate-700/50 border-b border-slate-700 select-none rounded-t-md">
                ▼ Error details
              </summary>
              <div className="p-4">
                <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-words max-h-60 overflow-auto bg-slate-950 p-3 rounded border border-slate-700">
                  {this.state.error.toString()}
                  {this.state.errorInfo && '\n\nComponent Stack:\n' + this.state.errorInfo.componentStack}
                </pre>
              </div>
            </details>
            
            {/* Action buttons */}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 border border-slate-700 rounded-md hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 group"
                title="Reload App"
                style={{
                  backgroundColor: theme.colors.background.elevated,
                  borderColor: theme.colors.border.default,
                  color: theme.colors.text.secondary
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = theme.colors.background.hover
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = theme.colors.background.elevated
                }}
              >
                Reload App
                <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">⇧⌘R</span>
              </button>
              
              <button
                onClick={this.resetError}
                className="px-4 py-2 text-sm font-medium rounded-md group inline-flex items-center gap-2 focus:outline-none focus:ring-2"
                title="Try Again (Enter)"
                autoFocus
                style={{
                  backgroundColor: theme.colors.accent.blue.DEFAULT,
                  color: theme.colors.text.inverse
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = theme.colors.accent.blue.dark
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = theme.colors.accent.blue.DEFAULT
                }}
              >
                <span>Try Again</span>
                <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">↵</span>
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary