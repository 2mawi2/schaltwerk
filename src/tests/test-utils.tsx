import React, { useEffect } from 'react'
import { render } from '@testing-library/react'
import { SelectionProvider } from '../contexts/SelectionContext'
import { FocusProvider } from '../contexts/FocusContext'
import { ReviewProvider } from '../contexts/ReviewContext'
import { ProjectProvider, useProject } from '../contexts/ProjectContext'
import { FontSizeProvider } from '../contexts/FontSizeContext'
import { SessionsProvider } from '../contexts/SessionsContext'
import { ActionButtonsProvider } from '../contexts/ActionButtonsContext'
import { RunProvider } from '../contexts/RunContext'
import { ModalProvider } from '../contexts/ModalContext'
import { ToastProvider } from '../common/toast/ToastProvider'

export function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      <ModalProvider>
        <FontSizeProvider>
          <ProjectProvider>
            <SessionsProvider>
              <ActionButtonsProvider>
                <SelectionProvider>
                  <FocusProvider>
                    <ReviewProvider>
                      <RunProvider>
                        {ui}
                      </RunProvider>
                    </ReviewProvider>
                  </FocusProvider>
                </SelectionProvider>
              </ActionButtonsProvider>
            </SessionsProvider>
          </ProjectProvider>
        </FontSizeProvider>
      </ModalProvider>
    </ToastProvider>
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
    <ToastProvider>
      <ModalProvider>
        <FontSizeProvider>
          <ProjectProvider>
            <TestProjectInitializer>
              <SessionsProvider>
                <ActionButtonsProvider>
                  <SelectionProvider>
                    <FocusProvider>
                      <ReviewProvider>
                        <RunProvider>
                          {children}
                        </RunProvider>
                      </ReviewProvider>
                    </FocusProvider>
                  </SelectionProvider>
                </ActionButtonsProvider>
              </SessionsProvider>
            </TestProjectInitializer>
          </ProjectProvider>
        </FontSizeProvider>
      </ModalProvider>
    </ToastProvider>
  )
}
