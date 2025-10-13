import { screen, waitFor } from '@testing-library/react'
import { TauriCommands } from '../../common/tauriCommands'
import userEvent from '@testing-library/user-event'
import { HomeScreen } from './HomeScreen'
import { renderWithProviders } from '../../tests/test-utils'

import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ homeDir: vi.fn().mockResolvedValue('/home/user') }))

const invoke = (await import('@tauri-apps/api/core')).invoke as unknown as ReturnType<typeof vi.fn>
const dialog = await import('@tauri-apps/plugin-dialog')

describe('HomeScreen', () => {
  const user = userEvent.setup()

  beforeEach(() => {
    invoke.mockReset()
    ;(dialog.open as ReturnType<typeof vi.fn>).mockReset()
  })

  function setup(overrides: Partial<Record<string, unknown>> = {}) {
    const onOpenProject = vi.fn()
    // Defaults - set BEFORE render so initial effect uses mocks
    invoke.mockImplementation(async (cmd: string, _args?: unknown) => {
      switch (cmd) {
        case TauriCommands.GetRecentProjects:
          return overrides.get_recent_projects ?? []
        case TauriCommands.IsGitRepository:
          return overrides.is_git_repository ?? true
        case TauriCommands.AddRecentProject:
        case TauriCommands.RemoveRecentProject:
        case TauriCommands.UpdateRecentProjectTimestamp:
        case TauriCommands.InitializeProject:
        case TauriCommands.CreateNewProject:
          return null
        case TauriCommands.DirectoryExists:
          return overrides.directory_exists ?? true
        default:
          throw new Error(`Unexpected invoke: ${cmd}`)
      }
    })

    renderWithProviders(<HomeScreen onOpenProject={onOpenProject} />, {
      githubOverrides: {
        status: { installed: true, authenticated: true, userLogin: null, repository: null },
        loading: false,
        authenticate: vi.fn(),
        connectProject: vi.fn(),
        refreshStatus: vi.fn(),
        createReviewedPr: vi.fn(),
      },
    })

    return { onOpenProject }
  }

  it('renders initial state with CTA and without recent projects', async () => {
    setup({ get_recent_projects: [] })

    // CTA button present
    expect(screen.getByRole('button', { name: /open repository/i })).toBeInTheDocument()

    // Recent Projects header should not be visible when empty
    await waitFor(() => {
      expect(screen.queryByText(/recent projects/i)).not.toBeInTheDocument()
    })
  })

  it('shows recent projects when available and allows removing without opening', async () => {
    const recent = [
      { path: '/repo/a', name: 'Project A', lastOpened: 2 },
      { path: '/repo/b', name: 'Project B', lastOpened: 1 },
    ]
    const { onOpenProject } = setup({ get_recent_projects: recent })

    // Cards rendered (sorted newest first by implementation)
    expect(await screen.findByText('Project A')).toBeInTheDocument()
    expect(screen.getByText('/repo/a')).toBeInTheDocument()

    // Click the remove button should not trigger open
    const removeButtons = screen.getAllByTitle(/remove .* from recent projects/i)
    await user.click(removeButtons[0])

    expect(onOpenProject).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith(TauriCommands.RemoveRecentProject, { path: '/repo/a' })
  })

  it('open button triggers directory picker and navigates on valid git repo', async () => {
    const { onOpenProject } = setup()
    ;(dialog.open as ReturnType<typeof vi.fn>).mockResolvedValue('/some/repo')

    const openBtn = screen.getByRole('button', { name: /open repository/i })
    await user.click(openBtn)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.IsGitRepository, { path: '/some/repo' })
    })
    expect(invoke).toHaveBeenCalledWith(TauriCommands.AddRecentProject, { path: '/some/repo' })
    expect(onOpenProject).toHaveBeenCalledWith('/some/repo')
  })

  it('shows error when selected directory is not a git repo', async () => {
    setup({ is_git_repository: false })
    ;(dialog.open as ReturnType<typeof vi.fn>).mockResolvedValue('/not/repo')

    await user.click(screen.getByRole('button', { name: /open repository/i }))

    expect(await screen.findByText(/not a git repository/i)).toBeInTheDocument()
    // should not navigate
    // Subtitle removed from HomeScreen; ensure page still renders core CTA
    expect(screen.getByRole('button', { name: /open repository/i })).toBeInTheDocument()
  })

  it('keyboard: pressing Enter on focused open button opens dialog', async () => {
    setup()
    ;(dialog.open as ReturnType<typeof vi.fn>).mockResolvedValue('/enter/repo')

    const btn = screen.getByRole('button', { name: /open repository/i })
    btn.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(dialog.open).toHaveBeenCalled()
    })
  })

  it('allows navigating to create a session (Cmd/Ctrl+N in App will open modal; here we ensure button exists)', async () => {
    setup()
    // Verify the CTA to start new session exists in App, but HomeScreen does not handle it.
    // We assert HomeScreen remains focusable and interactive via keyboard.
    const newProjectBtn = screen.getByRole('button', { name: /new project/i })
    await user.tab()
    expect(newProjectBtn).toHaveFocus()
  })

  it('opening a missing recent project shows an error and refreshes list', async () => {
    const recent = [{ path: '/gone/repo', name: 'Project Gone', lastOpened: 1 }]
    setup({ get_recent_projects: recent, directory_exists: false })

    // open card (button within card: click by project name)
    await user.click(await screen.findByText('Project Gone'))

    expect(await screen.findByText(/no longer exists/i)).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith(TauriCommands.RemoveRecentProject, { path: '/gone/repo' })
  })

  it('handles project creation and opens the new project', async () => {
    const { onOpenProject } = setup()
    
    // Mock successful project creation
    invoke.mockImplementation(async (cmd: string, _args?: unknown) => {
      switch (cmd) {
        case TauriCommands.GetRecentProjects:
          return []
        case TauriCommands.CreateNewProject:
          return '/new/project/path'
        default:
          return null
      }
    })

    // Click New Project button
    const newProjectBtn = screen.getByRole('button', { name: /new project/i })
    await user.click(newProjectBtn)

    // Dialog should open - use role selector to avoid ambiguity with button text
    expect(await screen.findByRole('heading', { name: 'New Project' })).toBeInTheDocument()

    // Fill in project details
    const nameInput = screen.getByPlaceholderText(/my-awesome-project/i)
    await user.type(nameInput, 'test-project')

    // Create project
    const createBtn = screen.getByRole('button', { name: /create project/i })
    await user.click(createBtn)

    // Should call create command and open the project
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(TauriCommands.CreateNewProject, {
        name: 'test-project',
        parentPath: expect.any(String)
      })
      expect(onOpenProject).toHaveBeenCalledWith('/new/project/path')
    })
  })
})
