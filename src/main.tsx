import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { EntryAnimation } from './components/EntryAnimation'
import { Provider as JotaiProvider } from 'jotai'
import { FocusProvider } from './contexts/FocusContext'
import { ReviewProvider } from './contexts/ReviewContext'
import { RunProvider } from './contexts/RunContext'
import { ModalProvider } from './contexts/ModalContext'
import ErrorBoundary from './components/ErrorBoundary'
import { KeyboardShortcutsProvider } from './contexts/KeyboardShortcutsContext'
import { ToastProvider } from './common/toast/ToastProvider'
import { GithubIntegrationProvider } from './contexts/GithubIntegrationContext'

// Loading wrapper component
const AppLoader: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Remove initial HTML loader if it exists
    const initialLoader = document.getElementById('initial-loader')
    if (initialLoader) {
      initialLoader.style.opacity = '0'
      setTimeout(() => {
        initialLoader.remove()
      }, 300)
    }

    rootRef.current?.focus()
  }, [])

  return (
    <EntryAnimation>
      <ErrorBoundary name="Root">
        <ToastProvider>
          <KeyboardShortcutsProvider>
            <JotaiProvider>
              <GithubIntegrationProvider>
                <ModalProvider>
                  <FocusProvider>
                    <ReviewProvider>
                      <RunProvider>
                        <div ref={rootRef} tabIndex={-1} className="h-screen w-screen outline-none">
                          <App />
                        </div>
                      </RunProvider>
                    </ReviewProvider>
                  </FocusProvider>
                </ModalProvider>
              </GithubIntegrationProvider>
            </JotaiProvider>
          </KeyboardShortcutsProvider>
        </ToastProvider>
      </ErrorBoundary>
    </EntryAnimation>
  )
}

const root = document.getElementById('root')!
const reactRoot = ReactDOM.createRoot(root)

reactRoot.render(
  <React.StrictMode>
    <AppLoader />
  </React.StrictMode>,
)
