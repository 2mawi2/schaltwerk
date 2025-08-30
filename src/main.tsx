import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { EntryAnimation } from './components/EntryAnimation'
import { SelectionProvider } from './contexts/SelectionContext'
import { FocusProvider } from './contexts/FocusContext'
import { ReviewProvider } from './contexts/ReviewContext'
import { ProjectProvider } from './contexts/ProjectContext'
import { FontSizeProvider } from './contexts/FontSizeContext'
import { SessionsProvider } from './contexts/SessionsContext'
import { ActionButtonsProvider } from './contexts/ActionButtonsContext'
import ErrorBoundary from './components/ErrorBoundary'

// Loading wrapper component
const AppLoader: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Remove initial HTML loader
    const initialLoader = document.getElementById('initial-loader')
    if (initialLoader) {
      initialLoader.style.opacity = '0'
      setTimeout(() => {
        initialLoader.remove()
      }, 300)
    }

    // Start animation immediately (no delay)
    setIsLoading(false)
  }, [])

  return (
    <EntryAnimation isLoading={isLoading}>
      <ErrorBoundary name="Root">
        <FontSizeProvider>
          <ProjectProvider>
            <SessionsProvider>
              <ActionButtonsProvider>
                <SelectionProvider>
                  <FocusProvider>
                    <ReviewProvider>
                      <div className="h-screen w-screen">
                        <App />
                      </div>
                    </ReviewProvider>
                  </FocusProvider>
                </SelectionProvider>
              </ActionButtonsProvider>
            </SessionsProvider>
          </ProjectProvider>
        </FontSizeProvider>
      </ErrorBoundary>
    </EntryAnimation>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppLoader />
  </React.StrictMode>,
)
