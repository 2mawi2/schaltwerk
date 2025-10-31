import React, { useEffect, useMemo } from 'react'
import { render } from '@testing-library/react'
import type { RenderOptions } from '@testing-library/react'
import { SelectionProvider } from '../contexts/SelectionContext'
import { FocusProvider } from '../contexts/FocusContext'
import { ReviewProvider } from '../contexts/ReviewContext'
import { SessionsProvider } from '../contexts/SessionsContext'
import { RunProvider } from '../contexts/RunContext'
import { ModalProvider } from '../contexts/ModalContext'
import { ToastProvider } from '../common/toast/ToastProvider'
import { GithubIntegrationContext } from '../contexts/GithubIntegrationContext'
import type { GithubIntegrationValue } from '../hooks/useGithubIntegration'
import type { ChangedFile } from '../common/events'
import { Provider, createStore, useSetAtom } from 'jotai'
import { projectPathAtom } from '../store/atoms/project'

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
  const store = useMemo(() => createStore(), [])

  const inner = (
    <SessionsProvider>
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
    </SessionsProvider>
  )

  const content = includeTestInitializer ? (
    <TestProjectInitializer>{inner}</TestProjectInitializer>
  ) : (
    inner
  )

  return (
    <Provider store={store}>
      <ToastProvider>
        <ModalProvider>
          {content}
        </ModalProvider>
      </ToastProvider>
    </Provider>
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
  const setProjectPath = useSetAtom(projectPathAtom)
  
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

export function createChangedFile(
  file: Partial<ChangedFile> & { path: string }
): ChangedFile {
  const additions = file.additions ?? 0
  const deletions = file.deletions ?? 0
  return {
    path: file.path,
    change_type: file.change_type ?? 'modified',
    additions,
    deletions,
    changes: file.changes ?? additions + deletions,
    is_binary: file.is_binary,
  }
}
