import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { EntryAnimation } from './components/EntryAnimation'
import { SelectionProvider } from './contexts/SelectionContext'
import { FocusProvider } from './contexts/FocusContext'
import { ReviewProvider } from './contexts/ReviewContext'
import { RunProvider } from './contexts/RunContext'
import { ProjectProvider } from './contexts/ProjectContext'
import { FontSizeProvider } from './contexts/FontSizeContext'
import { SessionsProvider } from './contexts/SessionsContext'
import { ActionButtonsProvider } from './contexts/ActionButtonsContext'
import { ModalProvider } from './contexts/ModalContext'
import ErrorBoundary from './components/ErrorBoundary'
import { KeyboardShortcutsProvider } from './contexts/KeyboardShortcutsContext'
import { ToastProvider } from './common/toast/ToastProvider'
import { GithubIntegrationProvider } from './contexts/GithubIntegrationContext'
import { SpecEditorStateProvider } from './contexts/SpecEditorStateContext'
import { GitHistoryProvider } from './contexts/GitHistoryContext'

// Loading wrapper component
const AppLoader: React.FC = () => {
  useEffect(() => {
    // Remove initial HTML loader if it exists
    const initialLoader = document.getElementById('initial-loader')
    if (initialLoader) {
      initialLoader.style.opacity = '0'
      setTimeout(() => {
        initialLoader.remove()
      }, 300)
    }
  }, [])

  return (
    <EntryAnimation>
      <ErrorBoundary name="Root">
        <ToastProvider>
          <FontSizeProvider>
            <KeyboardShortcutsProvider>
              <ProjectProvider>
                <GithubIntegrationProvider>
                  <SessionsProvider>
                    <SpecEditorStateProvider>
                      <GitHistoryProvider>
                        <ActionButtonsProvider>
                          <ModalProvider>
                            <SelectionProvider>
                              <FocusProvider>
                                <ReviewProvider>
                                  <RunProvider>
                                    <div className="h-screen w-screen">
                                      <App />
                                    </div>
                                  </RunProvider>
                                </ReviewProvider>
                              </FocusProvider>
                            </SelectionProvider>
                          </ModalProvider>
                        </ActionButtonsProvider>
                      </GitHistoryProvider>
                    </SpecEditorStateProvider>
                  </SessionsProvider>
                </GithubIntegrationProvider>
              </ProjectProvider>
            </KeyboardShortcutsProvider>
          </FontSizeProvider>
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
