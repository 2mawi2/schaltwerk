import React, { useEffect } from 'react'
import { render } from '@testing-library/react'
import { SelectionProvider } from '../contexts/SelectionContext'
import { FocusProvider } from '../contexts/FocusContext'
import { ReviewProvider } from '../contexts/ReviewContext'
import { ProjectProvider, useProject } from '../contexts/ProjectContext'
import { FontSizeProvider } from '../contexts/FontSizeContext'
import { SessionsProvider } from '../contexts/SessionsContext'
import { ActionButtonsProvider } from '../contexts/ActionButtonsContext'

export function renderWithProviders(ui: React.ReactElement) {
  return render(
    <FontSizeProvider>
      <ProjectProvider>
        <SessionsProvider>
          <ActionButtonsProvider>
            <SelectionProvider>
              <FocusProvider>
                <ReviewProvider>
                  {ui}
                </ReviewProvider>
              </FocusProvider>
            </SelectionProvider>
          </ActionButtonsProvider>
        </SessionsProvider>
      </ProjectProvider>
    </FontSizeProvider>
  )
}

// Component to set project path for tests
function TestProjectInitializer({ children }: { children: React.ReactNode }) {
  const { setProjectPath } = useProject()
  
  useEffect(() => {
    // Set a test project path immediately
    setProjectPath('/test/project')
  }, [setProjectPath])
  
  return <>{children}</>
}

export function TestProviders({ children }: { children: React.ReactNode }) {
  return (
    <FontSizeProvider>
      <ProjectProvider>
        <TestProjectInitializer>
          <SessionsProvider>
            <ActionButtonsProvider>
              <SelectionProvider>
                <FocusProvider>
                  <ReviewProvider>
                    {children}
                  </ReviewProvider>
                </FocusProvider>
              </SelectionProvider>
            </ActionButtonsProvider>
          </SessionsProvider>
        </TestProjectInitializer>
      </ProjectProvider>
    </FontSizeProvider>
  )
}