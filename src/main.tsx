import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { LoadingSpinner } from './components/common/LoadingSpinner'
import { SelectionProvider } from './contexts/SelectionContext'
import { FocusProvider } from './contexts/FocusContext'
import { ReviewProvider } from './contexts/ReviewContext'
import { ProjectProvider } from './contexts/ProjectContext'
import { FontSizeProvider } from './contexts/FontSizeContext'
import { SessionsProvider } from './contexts/SessionsContext'
import { ActionButtonsProvider } from './contexts/ActionButtonsContext'

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

    // Show loading spinner for a brief moment to ensure smooth transition
    const timer = setTimeout(() => {
      setIsLoading(false)
    }, 800)

    return () => clearTimeout(timer)
  }, [])

  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-primary">
        <LoadingSpinner size="lg" message="Initializing Schaltwerk..." />
      </div>
    )
  }

  return (
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
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppLoader />
  </React.StrictMode>,
)
