import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SessionActions } from '../SessionActions'
import { GithubIntegrationContext } from '../../../contexts/GithubIntegrationContext'
import type { GithubIntegrationValue } from '../../../hooks/useGithubIntegration'

const pushToast = vi.fn()

vi.mock('../../../common/toast/ToastProvider', () => ({
  useToast: () => ({ pushToast }),
}))

vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

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
    <GithubIntegrationContext.Provider value={contextValue}>
      <SessionActions
        sessionState="reviewed"
        sessionId="session-123"
        sessionSlug="session-123"
        worktreePath="/tmp/worktrees/session-123"
        defaultBranch="main"
        branch="feature/session-123"
      />
    </GithubIntegrationContext.Provider>
  )
}

describe('SessionActions – GitHub PR button', () => {
  beforeEach(() => {
    pushToast.mockClear()
  })

  it('disables the PR button when integration is not ready', () => {
    renderWithGithub({ canCreatePr: false })
    const button = screen.getByLabelText('Create GitHub pull request') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('creates a PR and shows success toast', async () => {
    const createReviewedPr = vi.fn().mockResolvedValue({
      branch: 'reviewed/session-123',
      url: 'https://github.com/owner/repo/pull/5',
    })

    renderWithGithub({ createReviewedPr })

    const button = screen.getByLabelText('Create GitHub pull request')
    fireEvent.click(button)

    await waitFor(() => {
      expect(createReviewedPr).toHaveBeenCalledWith({
        sessionId: 'session-123',
        sessionSlug: 'session-123',
        worktreePath: '/tmp/worktrees/session-123',
        defaultBranch: 'main',
      })
    })

    await waitFor(() => {
      expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({
        tone: 'success',
        title: 'Pull request created',
        description: 'https://github.com/owner/repo/pull/5',
      }))
    })
  })

  it('shows an error toast when PR creation fails', async () => {
    const createReviewedPr = vi.fn().mockRejectedValue(new Error('network error'))
    renderWithGithub({ createReviewedPr })

    const button = screen.getByLabelText('Create GitHub pull request')
    fireEvent.click(button)

    await waitFor(() => {
      expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({
        tone: 'error',
        title: 'GitHub pull request failed',
      }))
    })
  })
})
