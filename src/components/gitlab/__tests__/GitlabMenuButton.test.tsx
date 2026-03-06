import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '../../../tests/test-utils'
import { GitlabMenuButton } from '../GitlabMenuButton'
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

describe('GitlabMenuButton', () => {
  beforeEach(() => {
    pushToast.mockClear()
  })

  it('shows CLI install prompt when glab is missing', () => {
    renderWithProviders(
      <GitlabMenuButton />, {
        gitlabOverrides: {
          status: { installed: false, authenticated: false },
          sources: [],
          loading: false,
          isGlabMissing: true,
          hasSources: false,
          refreshStatus: vi.fn(),
          loadSources: vi.fn(),
          saveSources: vi.fn(),
        }
      }
    )

    const button = screen.getByRole('button', { name: /cli not installed/i })
    fireEvent.click(button)

    expect(screen.getByText(/glab/i)).toBeInTheDocument()
  })

  it('shows authentication instructions when not authenticated', () => {
    renderWithProviders(
      <GitlabMenuButton />, {
        gitlabOverrides: {
          status: { installed: true, authenticated: false },
          sources: [],
          loading: false,
          isGlabMissing: false,
          hasSources: false,
          refreshStatus: vi.fn(),
          loadSources: vi.fn(),
          saveSources: vi.fn(),
        }
      }
    )

    const trigger = screen.getByRole('button', { name: /not authenticated/i })
    fireEvent.click(trigger)

    expect(screen.getByText(/glab auth login/i)).toBeInTheDocument()
  })

  it('shows connected state with sources', () => {
    renderWithProviders(
      <GitlabMenuButton />, {
        gitlabOverrides: {
          status: { installed: true, authenticated: true, userLogin: 'dev', hostname: 'gitlab.com' },
          sources: [{ id: '1', label: 'Backend', projectPath: 'group/backend', hostname: 'gitlab.com', issuesEnabled: true, mrsEnabled: true, pipelinesEnabled: false }],
          loading: false,
          isGlabMissing: false,
          hasSources: true,
          refreshStatus: vi.fn(),
          loadSources: vi.fn(),
          saveSources: vi.fn(),
        }
      }
    )

    expect(screen.getByText(/1 source/i)).toBeInTheDocument()
  })

  it('shows configure state when authenticated but no sources', () => {
    renderWithProviders(
      <GitlabMenuButton />, {
        gitlabOverrides: {
          status: { installed: true, authenticated: true, userLogin: 'dev', hostname: 'gitlab.com' },
          sources: [],
          loading: false,
          isGlabMissing: false,
          hasSources: false,
          refreshStatus: vi.fn(),
          loadSources: vi.fn(),
          saveSources: vi.fn(),
        }
      }
    )

    expect(screen.getByText(/configure gitlab/i)).toBeInTheDocument()
  })

  it('displays hostname and account in dropdown', () => {
    renderWithProviders(
      <GitlabMenuButton />, {
        gitlabOverrides: {
          status: { installed: true, authenticated: true, userLogin: 'myuser', hostname: 'gitlab.example.com' },
          sources: [{ id: '1', label: 'App', projectPath: 'team/app', hostname: 'gitlab.example.com', issuesEnabled: true, mrsEnabled: true, pipelinesEnabled: false }],
          loading: false,
          isGlabMissing: false,
          hasSources: true,
          refreshStatus: vi.fn(),
          loadSources: vi.fn(),
          saveSources: vi.fn(),
        }
      }
    )

    fireEvent.click(screen.getByRole('button', { name: /1 source/i }))

    expect(screen.getByText('gitlab.example.com')).toBeInTheDocument()
    expect(screen.getByText('myuser')).toBeInTheDocument()
  })

  it('calls onConfigureSources when configure button is clicked', () => {
    const onConfigureSources = vi.fn()
    renderWithProviders(
      <GitlabMenuButton onConfigureSources={onConfigureSources} />, {
        gitlabOverrides: {
          status: { installed: true, authenticated: true, userLogin: 'dev', hostname: 'gitlab.com' },
          sources: [],
          loading: false,
          isGlabMissing: false,
          hasSources: false,
          refreshStatus: vi.fn(),
          loadSources: vi.fn(),
          saveSources: vi.fn(),
        }
      }
    )

    fireEvent.click(screen.getByRole('button', { name: /configure gitlab/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /configure/i }))

    expect(onConfigureSources).toHaveBeenCalledOnce()
  })

  it('closes menu on outside click', () => {
    renderWithProviders(
      <GitlabMenuButton />, {
        gitlabOverrides: {
          status: { installed: true, authenticated: true },
          sources: [],
          loading: false,
          isGlabMissing: false,
          hasSources: false,
          refreshStatus: vi.fn(),
          loadSources: vi.fn(),
          saveSources: vi.fn(),
        }
      }
    )

    fireEvent.click(screen.getByRole('button', { name: /configure gitlab/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
