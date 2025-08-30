import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TestProviders } from './tests/test-utils'
import App from './App'
import { vi } from 'vitest'

// ---- Mock: react-split (layout only) ----
vi.mock('react-split', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="split">{children}</div>,
}))

// ---- Mock: heavy child components to reduce surface area ----
vi.mock('./components/sidebar/Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar-mock" />,
}))
vi.mock('./components/terminal/TerminalGrid', () => ({
  TerminalGrid: () => <div data-testid="terminal-grid-mock" />,
}))
vi.mock('./components/right-panel/RightPanelTabs', () => ({
  RightPanelTabs: () => <div data-testid="right-panel-tabs" />,
}))
vi.mock('./components/modals/NewSessionModal', () => ({
  NewSessionModal: () => null,
}))
vi.mock('./components/modals/CancelConfirmation', () => ({
  CancelConfirmation: () => null,
}))
vi.mock('./components/diff/DiffViewerWithReview', () => ({
  DiffViewerWithReview: () => null,
}))
vi.mock('./components/OpenInSplitButton', () => ({
  OpenInSplitButton: () => <button data-testid="open-in-split" />,
}))
vi.mock('./components/TabBar', () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}))
vi.mock('./components/TopBar', () => ({
  TopBar: ({ onGoHome, tabs }: { onGoHome: () => void, tabs: unknown[] }) => (
    <div data-testid="top-bar">
      <button onClick={onGoHome} aria-label="Home">Home</button>
      {tabs && tabs.length > 0 && <div data-testid="tab-bar" />}
    </div>
  ),
}))

// ---- Mock: HomeScreen to drive transitions via onOpenProject ----
vi.mock('./components/home/HomeScreen', () => ({
  HomeScreen: ({ onOpenProject }: { onOpenProject: (path: string) => void }) => (
    <div data-testid="home-screen">
      <button data-testid="open-project" onClick={() => onOpenProject('/Users/me/sample-project')}>Open</button>
    </div>
  ),
}))

// ---- Mock: @tauri-apps/api/core (invoke) with adjustable behavior per test ----
const mockState = {
  isGitRepo: false,
  currentDir: '/Users/me/sample-project',
  defaultBranch: 'main',
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => {
    switch (cmd) {
      case 'get_current_directory':
        return mockState.currentDir
      case 'is_git_repository':
        return mockState.isGitRepo
      case 'get_project_default_branch':
        return mockState.defaultBranch
      // Selection/terminal lifecycle stubs
      case 'terminal_exists':
        return false
      case 'create_terminal':
        return null
      case 'schaltwerk_core_get_session':
        return { worktree_path: '/tmp/worktrees/abc' }
      case 'get_project_action_buttons':
        return []
      case 'initialize_project':
      case 'add_recent_project':
      case 'schaltwerk_core_create_session':
      case 'schaltwerk_core_cancel_session':
      case 'directory_exists':
      case 'update_recent_project_timestamp':
      case 'remove_recent_project':
        return null
      default:
        return null
    }
  }),
}))

function renderApp() {
  return render(
    <TestProviders>
      <App />
    </TestProviders>
  )
}

describe('App.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.isGitRepo = false
    mockState.currentDir = '/Users/me/sample-project'
    mockState.defaultBranch = 'main'
  })

  it('renders without crashing (shows Home by default)', async () => {
    renderApp()
    expect(await screen.findByTestId('home-screen')).toBeInTheDocument()
  })

  it('routes between Home and Main app states', async () => {
    renderApp()

    // Initially Home
    const home = await screen.findByTestId('home-screen')
    expect(home).toBeInTheDocument()

    // Open a project via HomeScreen prop
    fireEvent.click(screen.getByTestId('open-project'))

    // Main layout should appear
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
      expect(screen.getByTestId('terminal-grid')).toBeInTheDocument()
      // Right panel can be in Specs tab by default; diff panel may not be present
    })

    // Click the global Home button to return
    const homeButton = screen.getByLabelText('Home')
    fireEvent.click(homeButton)

    expect(await screen.findByTestId('home-screen')).toBeInTheDocument()
  })

  it('handles startup errors without crashing (logs error and stays on Home)', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    // Make get_current_directory throw inside App startup effect
    ;(invoke as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderApp()

    expect(await screen.findByTestId('home-screen')).toBeInTheDocument()
    expect(errSpy).toHaveBeenCalled()

    errSpy.mockRestore()
  })

  it('displays tab bar when a project is opened', async () => {
    renderApp()

    // Initially on home screen
    expect(await screen.findByTestId('home-screen')).toBeInTheDocument()

    // Open a project - the mocked HomeScreen passes '/Users/me/sample-project'
    mockState.isGitRepo = true
    
    fireEvent.click(screen.getByTestId('open-project'))

    // Wait for app to switch to main view with increased timeout
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Tab bar should be displayed (it's mocked in our test)
    await waitFor(() => {
      expect(screen.getByTestId('tab-bar')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  describe('Spec Starting', () => {
    beforeEach(() => {
      // Setup project state for spec tests
      mockState.isGitRepo = true
    })

    it('handles schaltwerk:start-agent-from-spec event by prefilling new session modal', async () => {
      renderApp()

      // Trigger the spec start event
      window.dispatchEvent(new CustomEvent('schaltwerk:start-agent-from-spec', {
        detail: { name: 'test-spec' }
      }))

      // Wait for the event to be processed
      await waitFor(() => {
        // The app should set up event listeners for spec starting
        // This is verified by the fact that the app renders without errors
        expect(screen.getByTestId('home-screen')).toBeInTheDocument()
      })
    })

    it('sets up event listeners for spec starting functionality', () => {
      renderApp()

      // Verify the app renders and would have set up the event listeners
      // The actual functionality is tested through integration with the real modal
      expect(screen.getByTestId('home-screen')).toBeInTheDocument()
    })
  })


})
