import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '../../../tests/test-utils'
import { GithubMenuButton } from '../GithubMenuButton'
import { vi } from 'vitest'

const pushToast = vi.fn()

vi.mock('../../../common/toast/ToastProvider', async () => {
  const actual = await vi.importActual<typeof import('../../../common/toast/ToastProvider')>(
    '../../../common/toast/ToastProvider'
  )
  return {
    ...actual,
    useToast: () => ({ pushToast }),
  }
})

describe('GithubMenuButton', () => {
  beforeEach(() => {
    pushToast.mockClear()
  })

  it('shows CLI install prompt when gh is missing', () => {
    renderWithProviders(
      <GithubMenuButton />, {
        githubOverrides: {
          status: { installed: false, authenticated: false, userLogin: null, repository: null },
          loading: false,
          authenticate: vi.fn(),
          connectProject: vi.fn(),
          refreshStatus: vi.fn(),
          createReviewedPr: vi.fn(),
        }
      }
    )

    const button = screen.getByRole('button', { name: /cli not installed/i })
    fireEvent.click(button)

    expect(screen.getByText(/Install the GitHub CLI to enable PR automation/i)).toBeInTheDocument()
  })

  it('shows authentication instructions when not authenticated', async () => {
    renderWithProviders(
      <GithubMenuButton />, {
        githubOverrides: {
          status: { installed: true, authenticated: false, userLogin: null, repository: null },
          loading: false,
          authenticate: vi.fn(),
          connectProject: vi.fn(),
          refreshStatus: vi.fn(),
          createReviewedPr: vi.fn(),
        }
      }
    )

    const trigger = screen.getByRole('button', { name: /not authenticated/i })
    fireEvent.click(trigger)

    expect(await screen.findByText(/gh auth login/i)).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /authenticate with github/i })).not.toBeInTheDocument()
  })

  it('displays connected repository details', () => {
    renderWithProviders(
      <GithubMenuButton hasActiveProject />, {
        githubOverrides: {
          status: {
            installed: true,
            authenticated: true,
            userLogin: 'octocat',
            repository: { nameWithOwner: 'owner/repo', defaultBranch: 'main' },
          },
          loading: false,
          authenticate: vi.fn(),
          connectProject: vi.fn(),
          refreshStatus: vi.fn(),
          createReviewedPr: vi.fn(),
        }
      }
    )

    fireEvent.click(screen.getByRole('button', { name: /owner\/repo/i }))
    expect(
      screen.getAllByText((content) => content.toLowerCase().includes('owner/repo')).length
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText((content) => content.toLowerCase().includes('default branch main')).length
    ).toBeGreaterThan(0)
  })
})
