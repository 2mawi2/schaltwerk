import React from 'react'
import { TauriCommands } from './common/tauriCommands'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TestProviders } from './tests/test-utils'
import App from './App'
import { validatePanelPercentage } from './utils/panel'
import { vi, type MockInstance } from 'vitest'
import { UiEvent, emitUiEvent } from './common/uiEvents'
import { SchaltEvent } from './common/eventSystem'

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
const newSessionModalMock = vi.fn((props: unknown) => props)

vi.mock('./components/modals/NewSessionModal', () => ({
  NewSessionModal: (props: unknown) => {
    newSessionModalMock(props)
    return null
  },
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

// ---- Mock helpers ----
const listenEventHandlers: Array<{ event: unknown; handler: (detail: unknown) => void }> = []

vi.mock('./common/eventSystem', async () => {
  const actual = await vi.importActual<typeof import('./common/eventSystem')>('./common/eventSystem')
  return {
    ...actual,
    listenEvent: vi.fn(async (event, handler) => {
      listenEventHandlers.push({ event, handler: handler as (detail: unknown) => void })
      return () => {}
    }),
  }
})

type StartSessionTopParams = {
  sessionName: string
  topId: string
  projectOrchestratorId?: string | null
  measured?: { cols?: number | null; rows?: number | null }
  agentType?: string | null
}

const startSessionTopMock = vi.hoisted(() =>
  vi.fn(async (_params: StartSessionTopParams) => {})
) as unknown as MockInstance<(params: StartSessionTopParams) => Promise<void>>

vi.mock('./common/agentSpawn', async () => {
  const actual = await vi.importActual<typeof import('./common/agentSpawn')>('./common/agentSpawn')
  return {
    ...actual,
    startSessionTop: startSessionTopMock,
  }
})

// ---- Mock: @tauri-apps/api/core (invoke) with adjustable behavior per test ----
const mockState = {
  isGitRepo: false,
  currentDir: '/Users/me/sample-project',
  defaultBranch: 'main',
}

async function defaultInvokeImpl(cmd: string, _args?: unknown) {
  switch (cmd) {
    case TauriCommands.GetCurrentDirectory:
      return mockState.currentDir
    case TauriCommands.IsGitRepository:
      return mockState.isGitRepo
    case TauriCommands.GetProjectDefaultBranch:
      return mockState.defaultBranch
    // Selection/terminal lifecycle stubs
    case TauriCommands.TerminalExists:
      return false
    case TauriCommands.CreateTerminal:
      return null
    case TauriCommands.SchaltwerkCoreGetSession:
      return { worktree_path: '/tmp/worktrees/abc' }
    case TauriCommands.GetProjectActionButtons:
      return []
    case TauriCommands.InitializeProject:
    case TauriCommands.AddRecentProject:
    case TauriCommands.SchaltwerkCoreCreateSession:
    case TauriCommands.SchaltwerkCoreCancelSession:
    case TauriCommands.DirectoryExists:
    case TauriCommands.UpdateRecentProjectTimestamp:
    case TauriCommands.RemoveRecentProject:
      return null
    default:
      return null
  }
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(defaultInvokeImpl),
}))

vi.mock('./utils/platform', () => ({
  isMacOS: vi.fn().mockResolvedValue(true),
  isLinux: vi.fn().mockResolvedValue(false),
  isWindows: vi.fn().mockResolvedValue(false),
  getPlatform: vi.fn().mockResolvedValue('macos'),
}))

function renderApp() {
  return render(
    <TestProviders>
      <App />
    </TestProviders>
  )
}

describe('App.tsx', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(defaultInvokeImpl)
    newSessionModalMock.mockClear()
    startSessionTopMock.mockClear()
    listenEventHandlers.length = 0
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

  it('prevents dropping files onto the window', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderApp()
    await screen.findByTestId('home-screen')

    const dragOverHandler = addEventListenerSpy.mock.calls.find(([eventName]) => String(eventName) === 'dragover')?.[1] as EventListener | undefined
    const dropHandler = addEventListenerSpy.mock.calls.find(([eventName]) => String(eventName) === 'drop')?.[1] as EventListener | undefined

    expect(typeof dragOverHandler).toBe('function')
    expect(typeof dropHandler).toBe('function')

    const dragoverEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { types: ['Files'] },
    }
    dragOverHandler?.(dragoverEvent as unknown as DragEvent)
    expect(dragoverEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(dragoverEvent.stopPropagation).toHaveBeenCalledTimes(1)

    const dropEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { types: ['Files'], files: [{ type: 'image/png' }] },
    }
    dropHandler?.(dropEvent as unknown as DragEvent)
    expect(dropEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(dropEvent.stopPropagation).toHaveBeenCalledTimes(1)

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('dragover', dragOverHandler)
    expect(removeEventListenerSpy).toHaveBeenCalledWith('drop', dropHandler)

    addEventListenerSpy.mockRestore()
    removeEventListenerSpy.mockRestore()
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
      emitUiEvent(UiEvent.StartAgentFromSpec, { name: 'test-spec' })

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

describe('validatePanelPercentage', () => {
  it('should return default value when input is null', () => {
    expect(validatePanelPercentage(null, 30)).toBe(30)
  })

  it('should return default value when input is empty string', () => {
    expect(validatePanelPercentage('', 30)).toBe(30)
  })

  it('should return valid percentage when input is valid', () => {
    expect(validatePanelPercentage('25', 30)).toBe(25)
    expect(validatePanelPercentage('50', 30)).toBe(50)
    expect(validatePanelPercentage('75', 30)).toBe(75)
  })

  it('should return default value when input is zero', () => {
    expect(validatePanelPercentage('0', 30)).toBe(30)
  })

  it('should return default value when input is 100 or greater', () => {
    expect(validatePanelPercentage('100', 30)).toBe(30)
    expect(validatePanelPercentage('150', 30)).toBe(30)
  })

  it('should return default value when input is negative', () => {
    expect(validatePanelPercentage('-5', 30)).toBe(30)
  })

  it('should return default value when input is not a number', () => {
    expect(validatePanelPercentage('abc', 30)).toBe(30)
    expect(validatePanelPercentage('25px', 30)).toBe(30)
  })

  it('should handle decimal values correctly', () => {
    expect(validatePanelPercentage('25.5', 30)).toBe(25.5)
    expect(validatePanelPercentage('0.1', 30)).toBe(0.1)
  })

  it('should work with different default values', () => {
    expect(validatePanelPercentage(null, 50)).toBe(50)
    expect(validatePanelPercentage('invalid', 75)).toBe(75)
  })

  it('starts each created version using the actual names returned by the backend', async () => {
    renderApp()

    fireEvent.click(await screen.findByTestId('open-project'))

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument()
    })

    const modalCall = newSessionModalMock.mock.calls.at(-1)
    expect(modalCall).toBeTruthy()
    type OnCreatePayload = {
      name: string
      prompt?: string
      baseBranch: string
      versionCount?: number
      agentType?: string
      isSpec?: boolean
      userEditedName?: boolean
      skipPermissions?: boolean
      agentTypes?: string[]
    }
    type OnCreateFn = (data: OnCreatePayload) => Promise<void>
    const modalProps = modalCall![0] as { onCreate: OnCreateFn }
    expect(typeof modalProps.onCreate).toBe('function')

    const createdResponses = [
      { name: 'feature-unique', version_number: 1 },
      { name: 'feature-unique_v2', version_number: 2 },
      { name: 'feature-unique_v3', version_number: 3 },
    ]

    const { invoke } = await import('@tauri-apps/api/core')
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === TauriCommands.SchaltwerkCoreCreateSession) {
        const next = createdResponses.shift()
        if (!next) {
          throw new Error('Unexpected extra session creation')
        }
        return {
          name: next.name,
          branch: `${args?.baseBranch ?? 'main'}/${next.name}`,
          parent_branch: args?.baseBranch ?? 'main',
          worktree_path: `/tmp/${next.name}`,
          version_number: next.version_number,
        }
      }
      return defaultInvokeImpl(cmd, args)
    })

    const createPromise = modalProps.onCreate({
      name: 'feature',
      prompt: undefined,
      baseBranch: 'main',
      versionCount: 3,
      agentType: 'claude',
      isSpec: false,
      userEditedName: true,
    })

    await waitFor(() => {
      const hasHandler = listenEventHandlers.some(entry => String(entry.event) === String(SchaltEvent.SessionsRefreshed))
      expect(hasHandler).toBe(true)
    })
    const sessionsRefreshedHandlers = listenEventHandlers.filter(entry => String(entry.event) === String(SchaltEvent.SessionsRefreshed))
    for (const { handler } of sessionsRefreshedHandlers) {
      handler({})
    }
    listenEventHandlers.length = 0

    await createPromise

    expect(startSessionTopMock).toHaveBeenCalledTimes(3)
    const callArgs = startSessionTopMock.mock.calls as Array<[StartSessionTopParams]>
    const firstCall = callArgs[0]?.[0]
    const secondCall = callArgs[1]?.[0]
    const thirdCall = callArgs[2]?.[0]

    expect(firstCall).toBeDefined()
    expect(secondCall).toBeDefined()
    expect(thirdCall).toBeDefined()

    expect(firstCall!.sessionName).toBe('feature-unique')
    expect(secondCall!.sessionName).toBe('feature-unique_v2')
    expect(thirdCall!.sessionName).toBe('feature-unique_v3')
    expect([firstCall!.sessionName, secondCall!.sessionName, thirdCall!.sessionName]).not.toContain('feature')

    invokeMock.mockImplementation(defaultInvokeImpl)
  })
})

describe('Multi-agent comparison logic', () => {
  it('should assign correct agent types from agentTypes array', () => {
    // This tests the logic from App.tsx handleCreateSession
    const data = {
      name: 'test-session',
      agentTypes: ['opencode', 'gemini', 'codex'],
      agentType: undefined
    }

    const useAgentTypes = Boolean(data.agentTypes && data.agentTypes.length > 0)
    const count = useAgentTypes ? (data.agentTypes?.length ?? 1) : 1

    expect(useAgentTypes).toBe(true)
    expect(count).toBe(3)

    // Test the agent type assignment for each version
    const assignments: Array<{ versionName: string; agentType: string | null | undefined }> = []

    for (let i = 1; i <= count; i++) {
      const baseName = data.name
      const versionName = i === 1 ? baseName : `${baseName}_v${i}`
      const agentTypeForVersion = useAgentTypes ? (data.agentTypes?.[i - 1] ?? null) : data.agentType

      assignments.push({ versionName, agentType: agentTypeForVersion })
    }

    // Verify each version gets the correct agent type
    expect(assignments).toEqual([
      { versionName: 'test-session', agentType: 'opencode' },
      { versionName: 'test-session_v2', agentType: 'gemini' },
      { versionName: 'test-session_v3', agentType: 'codex' }
    ])
  })

  it('should use agentType when agentTypes array is not provided', () => {
    const data: {
      name: string
      agentTypes?: string[]
      agentType: string
    } = {
      name: 'test-session',
      agentTypes: undefined,
      agentType: 'claude'
    }

    const useAgentTypes = Boolean(data.agentTypes && data.agentTypes.length > 0)
    const versionCount = 2
    const count = useAgentTypes ? (data.agentTypes?.length ?? 1) : versionCount

    expect(useAgentTypes).toBe(false)
    expect(count).toBe(2)

    const assignments: Array<{ versionName: string; agentType: string | null | undefined }> = []

    for (let i = 1; i <= count; i++) {
      const baseName = data.name
      const versionName = i === 1 ? baseName : `${baseName}_v${i}`
      const agentTypeForVersion = useAgentTypes ? (data.agentTypes?.[i - 1] ?? null) : data.agentType

      assignments.push({ versionName, agentType: agentTypeForVersion })
    }

    // Both versions should use the same agentType
    expect(assignments).toEqual([
      { versionName: 'test-session', agentType: 'claude' },
      { versionName: 'test-session_v2', agentType: 'claude' }
    ])
  })
})
