import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SessionActions } from '../SessionActions'
import { GithubIntegrationContext } from '../../../contexts/GithubIntegrationContext'
import type { GithubIntegrationValue } from '../../../hooks/useGithubIntegration'
import { GitlabIntegrationContext } from '../../../contexts/GitlabIntegrationContext'
import type { GitlabIntegrationValue } from '../../../hooks/useGitlabIntegration'

const pushToast = vi.fn()

vi.mock('../../../common/toast/ToastProvider', () => ({
  useToast: () => ({ pushToast }),
}))

vi.mock('../../../hooks/usePrComments', () => ({
  usePrComments: () => ({
    fetchingComments: false,
    fetchAndPasteToTerminal: vi.fn(),
    fetchAndCopyToClipboard: vi.fn(),
  }),
}))

const defaultGitlabValue: GitlabIntegrationValue = {
  status: null,
  sources: [],
  loading: false,
  isGlabMissing: false,
  hasSources: false,
  refreshStatus: async () => {},
  loadSources: async () => {},
  saveSources: async () => {},
}

function renderWithGithub(value: Partial<GithubIntegrationValue>) {
  const defaultValue: GithubIntegrationValue = {
    status: {
      installed: true,
      authenticated: true,
      userLogin: 'tester',
      repository: {
        nameWithOwner: 'owner/repo',
        defaultBranch: 'main',
      },
    },
    loading: false,
    isAuthenticating: false,
    isConnecting: false,
    isCreatingPr: () => false,
    authenticate: vi.fn(),
    connectProject: vi.fn(),
    createReviewedPr: vi.fn(),
    getCachedPrUrl: () => undefined,
    canCreatePr: true,
    isGhMissing: false,
    hasRepository: true,
    refreshStatus: vi.fn(),
  }

  const contextValue: GithubIntegrationValue = { ...defaultValue, ...value }

  return render(
    <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
      <GithubIntegrationContext.Provider value={contextValue}>
        <SessionActions
          sessionState="reviewed"
          isReadyToMerge={true}
          sessionId="session-123"
          onCreatePullRequest={vi.fn()}
        />
      </GithubIntegrationContext.Provider>
    </GitlabIntegrationContext.Provider>
  )
}

describe('SessionActions – GitHub PR button', () => {
  it('disables the PR button when integration is not ready', () => {
    renderWithGithub({ canCreatePr: false })
    const button = screen.getByLabelText('Create pull request') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('invokes the provided PR callback', async () => {
    const onCreatePullRequest = vi.fn()
    const defaultValue: GithubIntegrationValue = {
      status: {
        installed: true,
        authenticated: true,
        userLogin: 'tester',
        repository: {
          nameWithOwner: 'owner/repo',
          defaultBranch: 'main',
        },
      },
      loading: false,
      isAuthenticating: false,
      isConnecting: false,
      isCreatingPr: () => false,
      authenticate: vi.fn(),
      connectProject: vi.fn(),
      createReviewedPr: vi.fn(),
      getCachedPrUrl: () => undefined,
      canCreatePr: true,
      isGhMissing: false,
      hasRepository: true,
      refreshStatus: vi.fn(),
    }

    render(
      <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
        <GithubIntegrationContext.Provider value={defaultValue}>
          <SessionActions
            sessionState="reviewed"
            isReadyToMerge={true}
            sessionId="session-123"
            onCreatePullRequest={onCreatePullRequest}
          />
        </GithubIntegrationContext.Provider>
      </GitlabIntegrationContext.Provider>
    )

    const button = screen.getByLabelText('Create pull request')
    fireEvent.click(button)

    await waitFor(() => {
      expect(onCreatePullRequest).toHaveBeenCalledWith('session-123')
    })
  })

  it('disables the PR button when callback is missing', () => {
    const defaultValue = {
      canCreatePr: true,
      isGhMissing: false,
      hasRepository: true,
    } as unknown as GithubIntegrationValue

    render(
      <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
        <GithubIntegrationContext.Provider value={defaultValue}>
          <SessionActions
            sessionState="reviewed"
            isReadyToMerge={true}
            sessionId="session-123"
          />
        </GithubIntegrationContext.Provider>
      </GitlabIntegrationContext.Provider>
    )

    const button = screen.getByLabelText('Create pull request') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})

describe('SessionActions – Running state', () => {
  const mockGithub = {
    canCreatePr: true,
    isGhMissing: false,
    hasRepository: true,
  } as unknown as GithubIntegrationValue

  it('shows quick merge button when onQuickMerge is provided', () => {
    const onQuickMerge = vi.fn()
    render(
      <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
        <GithubIntegrationContext.Provider value={mockGithub}>
          <SessionActions
            sessionState="running"
            isReadyToMerge={false}
            sessionId="session-123"
            onQuickMerge={onQuickMerge}
          />
        </GithubIntegrationContext.Provider>
      </GitlabIntegrationContext.Provider>
    )

    const button = screen.getByLabelText('Quick merge session')
    expect(button).toBeInTheDocument()
    fireEvent.click(button)
    expect(onQuickMerge).toHaveBeenCalledWith('session-123')
  })

  it('does not show quick merge button when onQuickMerge is missing', () => {
    render(
      <GitlabIntegrationContext.Provider value={defaultGitlabValue}>
        <GithubIntegrationContext.Provider value={mockGithub}>
          <SessionActions
            sessionState="running"
            isReadyToMerge={false}
            sessionId="session-123"
          />
        </GithubIntegrationContext.Provider>
      </GitlabIntegrationContext.Provider>
    )

    const button = screen.queryByLabelText('Quick merge session')
    expect(button).not.toBeInTheDocument()
  })
})
