import React, { useEffect, useMemo } from 'react'
import { render } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
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
import { GithubIntegrationContext } from '../contexts/GithubIntegrationContext'
import type { GithubIntegrationValue } from '../hooks/useGithubIntegration'

type GithubOverrides = Partial<GithubIntegrationValue>

function createGithubIntegrationValue(overrides?: GithubOverrides): GithubIntegrationValue {
  const unimplemented = (method: string) => async () => {
    throw new Error(
      `GithubIntegration mock "${method}" not configured. Provide githubOverrides when using renderWithProviders/TestProviders.`
    )
  }

  const base: GithubIntegrationValue = {
    status: null,
    loading: false,
    isAuthenticating: false,
    isConnecting: false,
    isCreatingPr: () => false,
    authenticate: unimplemented('authenticate'),
    connectProject: unimplemented('connectProject'),
    createReviewedPr: unimplemented('createReviewedPr'),
    getCachedPrUrl: () => undefined,
    canCreatePr: false,
    isGhMissing: false,
    hasRepository: false,
    refreshStatus: async () => {},
  }

  return overrides ? { ...base, ...overrides } : base
}

function GithubIntegrationTestProvider({
  overrides,
  children,
}: {
  overrides?: GithubOverrides
  children: React.ReactNode
}) {
  const value = useMemo(() => createGithubIntegrationValue(overrides), [overrides])
  return (
    <GithubIntegrationContext.Provider value={value}>
      {children}
    </GithubIntegrationContext.Provider>
  )
}

interface ProviderTreeProps {
  children: React.ReactNode
  githubOverrides?: GithubOverrides
  includeTestInitializer?: boolean
}

function ProviderTree({ children, githubOverrides, includeTestInitializer = false }: ProviderTreeProps) {
  const inner = (
    <SessionsProvider>
      <ActionButtonsProvider>
        <SelectionProvider>
          <FocusProvider>
            <ReviewProvider>
              <RunProvider>
                <GithubIntegrationTestProvider overrides={githubOverrides}>
                  {children}
                </GithubIntegrationTestProvider>
              </RunProvider>
            </ReviewProvider>
          </FocusProvider>
        </SelectionProvider>
      </ActionButtonsProvider>
    </SessionsProvider>
  )

  return (
    <ToastProvider>
      <ModalProvider>
        <FontSizeProvider>
          <ProjectProvider>
            {includeTestInitializer ? (
              <TestProjectInitializer>{inner}</TestProjectInitializer>
            ) : (
              inner
            )}
          </ProjectProvider>
        </FontSizeProvider>
      </ModalProvider>
    </ToastProvider>
  )
}

interface RenderWithProvidersOptions extends RenderOptions {
  githubOverrides?: GithubOverrides
}

export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {}
) {
  const { githubOverrides, ...renderOptions } = options
  return render(
    <ProviderTree githubOverrides={githubOverrides}>{ui}</ProviderTree>,
    renderOptions
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

export function TestProviders({
  children,
  githubOverrides,
}: {
  children: React.ReactNode
  githubOverrides?: GithubOverrides
}) {
  return (
    <ProviderTree githubOverrides={githubOverrides} includeTestInitializer>
      {children}
    </ProviderTree>
  )
}
