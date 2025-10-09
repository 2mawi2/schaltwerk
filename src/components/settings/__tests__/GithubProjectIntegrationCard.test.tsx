import { render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { GithubIntegrationContext } from '../../../contexts/GithubIntegrationContext'
import { GithubIntegrationValue } from '../../../hooks/useGithubIntegration'
import GithubProjectIntegrationCard from '../GithubProjectIntegrationCard'

const createGithubValue = (
  statusOverrides: Partial<GithubIntegrationValue['status']>,
  overrides: Partial<GithubIntegrationValue> = {}
): GithubIntegrationValue => {
  const status = {
    installed: true,
    authenticated: false,
    userLogin: null,
    repository: null,
    ...statusOverrides,
  }

  return {
    status,
    loading: false,
    isAuthenticating: false,
    isConnecting: false,
    isCreatingPr: () => false,
    authenticate: vi.fn(async () => status),
    connectProject: vi.fn(async () => { throw new Error('not implemented') }),
    createReviewedPr: vi.fn(async () => { throw new Error('not implemented') }),
    getCachedPrUrl: vi.fn(),
    canCreatePr: false,
    isGhMissing: false,
    hasRepository: Boolean(status.repository),
    refreshStatus: vi.fn(async () => {}),
    ...overrides,
  }
}

const renderCard = (value: GithubIntegrationValue, onNotify = vi.fn()) =>
  render(
    <GithubIntegrationContext.Provider value={value}>
      <GithubProjectIntegrationCard projectPath="/tmp/project" onNotify={onNotify} />
    </GithubIntegrationContext.Provider>
  )

describe('GithubProjectIntegrationCard authentication status', () => {
  test('renders a compact callout guiding the user to authenticate', () => {
    const value = createGithubValue({ installed: true, authenticated: false })
    renderCard(value)

    const callout = screen.getByTestId('github-auth-status')

    expect(callout).toHaveTextContent('GitHub CLI authentication required')
    expect(callout).toHaveTextContent('Run gh auth login')
    expect(callout.style.maxWidth).toBe('360px')
  })

  test('shows inline error details when authentication fails', async () => {
    const authenticate = vi.fn(async () => {
      throw new Error(
        'gh command failed (auth login): GitHub CLI authentication must be done in your terminal. To authenticate: 1. Open your terminal 2. Run: gh auth login 3. Follow the prompts to authenticate 4. Return to Schaltwerk and the status will update automatically'
      )
    })
    const onNotify = vi.fn()
    const value = createGithubValue({ installed: true, authenticated: false }, { authenticate })

    renderCard(value, onNotify)

    await userEvent.click(screen.getByRole('button', { name: 'Authenticate' }))

    const feedback = await screen.findByTestId('github-auth-feedback')
    expect(feedback).toHaveTextContent('Authentication failed')
    const lines = within(feedback).getAllByText(/^\d\./)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toHaveTextContent('1. Open your terminal')
    expect(lines[1]).toHaveTextContent('2. Run: gh auth login')
    expect(lines[2]).toHaveTextContent('3. Follow the prompts to authenticate')
    expect(lines[3]).toHaveTextContent('4. Return to Schaltwerk and the status will update automatically')

    expect(onNotify).not.toHaveBeenCalled()
  })

  test('shows inline success state without triggering duplicate toast', async () => {
    const authenticate = vi.fn(async () => ({
      installed: true,
      authenticated: true,
      userLogin: 'codex-bot',
      repository: null,
    }))
    const onNotify = vi.fn()
    const value = createGithubValue({ installed: true, authenticated: false }, { authenticate })

    renderCard(value, onNotify)

    await userEvent.click(screen.getByRole('button', { name: 'Authenticate' }))

    const feedback = await screen.findByTestId('github-auth-feedback')
    expect(feedback).toHaveTextContent('Authenticated as codex-bot')
    expect(onNotify).not.toHaveBeenCalled()
  })
})
