import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import { SelectionProvider } from './contexts/SelectionContext'
import { FocusProvider } from './contexts/FocusContext'
import { ReviewProvider } from './contexts/ReviewContext'
import { ProjectProvider } from './contexts/ProjectContext'
import { FontSizeProvider } from './contexts/FontSizeContext'
import { SessionsProvider } from './contexts/SessionsContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FontSizeProvider>
      <ProjectProvider>
        <SessionsProvider>
          <SelectionProvider>
            <FocusProvider>
              <ReviewProvider>
                <div className="h-screen w-screen">
                  <App />
                </div>
              </ReviewProvider>
            </FocusProvider>
          </SelectionProvider>
        </SessionsProvider>
      </ProjectProvider>
    </FontSizeProvider>
  </React.StrictMode>,
)
