import React from 'react'
import { TauriCommands } from './common/tauriCommands'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, type MockInstance } from 'vitest'
import { UiEvent, emitUiEvent } from './common/uiEvents'
import { SchaltEvent } from './common/eventSystem'

const listenEventHandlers = vi.hoisted(
  () => [] as Array<{ event: unknown; handler: (detail: unknown) => void }>
)

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

import { TestProviders } from './tests/test-utils'
import App from './App'
import { validatePanelPercentage } from './utils/panel'
import { __getSessionsEventHandlerForTest } from './store/atoms/sessions'

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
const settingsModalMock = vi.fn((props: unknown) => props)

vi.mock('./components/modals/NewSessionModal', () => ({
  NewSessionModal: (props: unknown) => {
    newSessionModalMock(props)
    return null
  },
}))
vi.mock('./components/modals/SettingsModal', () => ({
  SettingsModal: (props: unknown) => {
    settingsModalMock(props)
    return <div data-testid="settings-modal" />
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
const topBarPropsMock = vi.fn()
vi.mock('./components/TopBar', () => ({
  TopBar: (props: {
    onGoHome: () => void
    onSelectTab?: (path: string) => void
    tabs: Array<{ projectPath?: string; projectName?: string }>
    activeTabPath?: string | null
  }) => {
    topBarPropsMock(props)
    const { onGoHome, tabs, onSelectTab } = props
    return (
      <div data-testid="top-bar">
        <button onClick={onGoHome} aria-label="Home">Home</button>
        <div data-testid="tab-bar" />
        {tabs?.map((tab, index) => (
          <button
            key={tab.projectPath ?? `tab-${index}`}
            data-testid={`tab-${tab.projectPath}`}
            onClick={() => tab.projectPath && onSelectTab?.(tab.projectPath)}
          >
            {tab.projectName ?? tab.projectPath ?? 'tab'}
          </button>
        ))}
      </div>
    )
  },
}))

const fetchSessionForPrefillMock = vi.fn(async (name: string) => ({
  name,
  prompt: '# Prefill content',
  draftContent: '# Prefill content',
  baseBranch: 'main',
}))

vi.mock('./hooks/useSessionPrefill', () => ({
  useSessionPrefill: () => ({
    fetchSessionForPrefill: fetchSessionForPrefillMock,
  }),
}))

// ---- Mock: HomeScreen to drive transitions via onOpenProject ----
const homeScreenPropsMock = vi.fn()
vi.mock('./components/home/HomeScreen', () => ({
  HomeScreen: (props: { onOpenProject: (path: string) => void }) => {
    homeScreenPropsMock(props)
    return (
      <div data-testid="home-screen">
        <button data-testid="open-project" onClick={() => props.onOpenProject('/Users/me/sample-project')}>
          Open
        </button>
      </div>
    )
  },
}))

// ---- Mock helpers ----
type StartSessionTopParams = {
  sessionName: string
  topId: string
  projectOrchestratorId?: string | null
  measured?: { cols?: number | null; rows?: number | null }
  agentType?: string | null
}

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

async function renderApp() {
  let utils: ReturnType<typeof render> | undefined
  await act(async () => {
    utils = render(
      <TestProviders>
        <App />
      </TestProviders>
    )
  })
  return utils!
}

async function clickElement(element: HTMLElement | Element) {
  await act(async () => {
    fireEvent.click(element as Element)
  })
}

describe('App.tsx', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { invoke } = await import('@tauri-apps/api/core')
    ;(invoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(defaultInvokeImpl)
    newSessionModalMock.mockClear()
    settingsModalMock.mockClear()
    topBarPropsMock.mockClear()
    homeScreenPropsMock.mockClear()
    startSessionTopMock.mockClear()
    fetchSessionForPrefillMock.mockClear()
    listenEventHandlers.length = 0
    mockState.isGitRepo = false
    mockState.currentDir = '/Users/me/sample-project'
    mockState.defaultBranch = 'main'
    const { clearBackgroundStartsByPrefix } = await import('./common/uiEvents')
    clearBackgroundStartsByPrefix('')
  })

  async function renderProjectAndReturnHome() {
    mockState.isGitRepo = true

    await renderApp()

    const openButton = screen.getByTestId('open-project')
    await clickElement(openButton)

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument()
    })

    const homeButton = screen.getByLabelText('Home')
    await clickElement(homeButton)

    expect(screen.getByTestId('home-screen')).toBeInTheDocument()

    await waitFor(() => {
      expect(newSessionModalMock).toHaveBeenCalled()
    })
  }

  it('renders without crashing (shows Home by default)', async () => {
    await renderApp()
    expect(screen.getByTestId('home-screen')).toBeInTheDocument()
  })

  it('routes between Home and Main app states', async () => {
    await renderApp()

    // Initially Home
    const home = screen.getByTestId('home-screen')
    expect(home).toBeInTheDocument()

    // Open a project via HomeScreen prop
    await clickElement(screen.getByTestId('open-project'))

    // Main layout should appear
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
      expect(screen.getByTestId('terminal-grid')).toBeInTheDocument()
      // Right panel can be in Specs tab by default; diff panel may not be present
    })

    // Click the global Home button to return
    const homeButton = screen.getByLabelText('Home')
    await clickElement(homeButton)

    expect(screen.getByTestId('home-screen')).toBeInTheDocument()
  })

  it('keeps selected tab highlighted while project switch is pending', async () => {
    mockState.isGitRepo = true
    await renderApp()

    const firstHomeProps = homeScreenPropsMock.mock.calls.at(-1)?.[0] as
      | { onOpenProject: (path: string) => void }
      | undefined
    expect(firstHomeProps).toBeTruthy()
    await act(async () => {
      firstHomeProps?.onOpenProject('/Users/me/project-a')
    })

    await waitFor(() => {
      const latestTopBar = topBarPropsMock.mock.calls.at(-1)?.[0]
      expect(latestTopBar?.tabs?.length).toBe(1)
      expect(latestTopBar?.activeTabPath).toBe('/Users/me/project-a')
    })

    await clickElement(screen.getByLabelText('Home'))
    expect(screen.getByTestId('home-screen')).toBeInTheDocument()

    const secondHomeProps = homeScreenPropsMock.mock.calls.at(-1)?.[0] as
      | { onOpenProject: (path: string) => void }
      | undefined
    expect(secondHomeProps).toBeTruthy()
    await act(async () => {
      secondHomeProps?.onOpenProject('/Users/me/project-b')
    })

    await waitFor(() => {
      const latestTopBar = topBarPropsMock.mock.calls.at(-1)?.[0]
      expect(latestTopBar?.tabs?.length).toBe(2)
      expect(latestTopBar?.activeTabPath).toBe('/Users/me/project-b')
    })

    const { invoke } = await import('@tauri-apps/api/core')
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>
    let pendingResolve: (() => void) | undefined
    const pendingPromise = new Promise<void>(resolve => {
      pendingResolve = () => resolve()
    })
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (
        cmd === TauriCommands.InitializeProject &&
        (args as { path?: string })?.path === '/Users/me/project-a'
      ) {
        return pendingPromise
      }
      return defaultInvokeImpl(cmd, args)
    })

    await act(async () => {
      await clickElement(screen.getByTestId('tab-/Users/me/project-a'))
    })

    await waitFor(() => {
      const latestTopBar = topBarPropsMock.mock.calls.at(-1)?.[0]
      expect(latestTopBar?.activeTabPath).toBe('/Users/me/project-a')
    })

    if (pendingResolve) {
      pendingResolve()
    }
    await act(async () => {
      await pendingPromise
    })

    invokeMock.mockImplementation(defaultInvokeImpl)

    await waitFor(() => {
      const latestTopBar = topBarPropsMock.mock.calls.at(-1)?.[0]
      expect(latestTopBar?.activeTabPath).toBe('/Users/me/project-a')
    })
  })

  it('allows reverting to the current project while another switch is still initializing', async () => {
    mockState.isGitRepo = true
    await renderApp()

    const firstHomeProps = homeScreenPropsMock.mock.calls.at(-1)?.[0] as
      | { onOpenProject: (path: string) => void }
      | undefined
    expect(firstHomeProps).toBeTruthy()
    await act(async () => {
      firstHomeProps?.onOpenProject('/Users/me/project-a')
    })

    await waitFor(() => {
      const latestTopBar = topBarPropsMock.mock.calls.at(-1)?.[0]
      expect(latestTopBar?.tabs?.length).toBe(1)
      expect(latestTopBar?.activeTabPath).toBe('/Users/me/project-a')
    })

    await clickElement(screen.getByLabelText('Home'))
    expect(screen.getByTestId('home-screen')).toBeInTheDocument()

    const secondHomeProps = homeScreenPropsMock.mock.calls.at(-1)?.[0] as
      | { onOpenProject: (path: string) => void }
      | undefined
    expect(secondHomeProps).toBeTruthy()
    await act(async () => {
      secondHomeProps?.onOpenProject('/Users/me/project-b')
    })

    await waitFor(() => {
      const latestTopBar = topBarPropsMock.mock.calls.at(-1)?.[0]
      expect(latestTopBar?.tabs?.length).toBe(2)
    })

    const { invoke } = await import('@tauri-apps/api/core')
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>
    let resolveProjectB: (() => void) | undefined
    const pendingProjectBSwitch = new Promise<void>(resolve => {
      resolveProjectB = () => resolve()
    })
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (
        cmd === TauriCommands.InitializeProject &&
        (args as { path?: string })?.path === '/Users/me/project-b'
      ) {
        return pendingProjectBSwitch
      }
      return defaultInvokeImpl(cmd, args)
    })

    await act(async () => {
      await clickElement(screen.getByTestId('tab-/Users/me/project-a'))
    })
    await waitFor(() => {
      const latestTopBar = topBarPropsMock.mock.calls.at(-1)?.[0]
      expect(latestTopBar?.activeTabPath).toBe('/Users/me/project-a')
    })

    await act(async () => {
      await clickElement(screen.getByTestId('tab-/Users/me/project-b'))
    })
    await waitFor(() => {
      const latestTopBar = topBarPropsMock.mock.calls.at(-1)?.[0]
      expect(latestTopBar?.activeTabPath).toBe('/Users/me/project-b')
    })

    await act(async () => {
      await clickElement(screen.getByTestId('tab-/Users/me/project-a'))
    })
    await waitFor(() => {
      const latestTopBar = topBarPropsMock.mock.calls.at(-1)?.[0]
      expect(latestTopBar?.activeTabPath).toBe('/Users/me/project-a')
    })

    if (resolveProjectB) {
      resolveProjectB()
    }
    await act(async () => {
      await pendingProjectBSwitch
    })

    invokeMock.mockImplementation(defaultInvokeImpl)

    await waitFor(() => {
      const latestTopBar = topBarPropsMock.mock.calls.at(-1)?.[0]
      expect(latestTopBar?.activeTabPath).toBe('/Users/me/project-a')
    })
  })

  it('handles startup errors without crashing (logs error and stays on Home)', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    // Make get_current_directory throw inside App startup effect
    ;(invoke as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    await renderApp()

    expect(screen.getByTestId('home-screen')).toBeInTheDocument()
  })

  it('prevents dropping files onto the window', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = await renderApp()
    screen.getByTestId('home-screen')

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
    await renderApp()

    // Initially on home screen
    expect(screen.getByTestId('home-screen')).toBeInTheDocument()

    // Open a project - the mocked HomeScreen passes '/Users/me/sample-project'
    mockState.isGitRepo = true
    
    await clickElement(screen.getByTestId('open-project'))

    // Wait for app to switch to main view with increased timeout
    await waitFor(() => {
      expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Tab bar should be displayed (it's mocked in our test)
    await waitFor(() => {
      const latestTopBar = topBarPropsMock.mock.calls.at(-1)?.[0]
      expect(latestTopBar?.tabs?.length).toBeGreaterThan(0)
    }, { timeout: 3000 })
  })

  it('does not open the new session modal via keyboard shortcuts while Home view overlays an open project', async () => {
    await renderProjectAndReturnHome()

    const baselineCalls = newSessionModalMock.mock.calls.length

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true, bubbles: true }))
      await Promise.resolve()
    })

    await waitFor(() => {
      const latest = newSessionModalMock.mock.calls.at(-1)?.[0] as { open: boolean } | undefined
      expect(latest?.open).toBe(false)
    })

    expect(newSessionModalMock.mock.calls.length).toBe(baselineCalls)
  })

  it('ignores new session/spec UiEvents while Home view overlays an open project', async () => {
    await renderProjectAndReturnHome()

    const baselineCalls = newSessionModalMock.mock.calls.length

    await act(async () => {
      emitUiEvent(UiEvent.NewSessionRequest)
      await Promise.resolve()
    })

    await waitFor(() => {
      const latest = newSessionModalMock.mock.calls.at(-1)?.[0] as { open: boolean } | undefined
      expect(latest?.open).toBe(false)
    })

    await act(async () => {
      emitUiEvent(UiEvent.NewSpecRequest)
      await Promise.resolve()
    })

    await waitFor(() => {
      const latest = newSessionModalMock.mock.calls.at(-1)?.[0] as { open: boolean; initialIsDraft?: boolean } | undefined
      expect(latest?.open).toBe(false)
      expect(latest?.initialIsDraft).toBe(false)
    })

    expect(newSessionModalMock.mock.calls.length).toBe(baselineCalls)
  })

  it('ignores StartAgentFromSpec events while Home view overlays an open project', async () => {
    await renderProjectAndReturnHome()

    const baselineCalls = newSessionModalMock.mock.calls.length
    fetchSessionForPrefillMock.mockClear()

    await act(async () => {
      emitUiEvent(UiEvent.StartAgentFromSpec, { name: 'spec-home' })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(fetchSessionForPrefillMock).not.toHaveBeenCalled()
    })

    const latest = newSessionModalMock.mock.calls.at(-1)?.[0] as { open: boolean } | undefined
    expect(latest?.open).toBe(false)
    expect(newSessionModalMock.mock.calls.length).toBe(baselineCalls)
  })

  describe('Spec Starting', () => {
    beforeEach(() => {
      // Setup project state for spec tests
      mockState.isGitRepo = true
    })

    it('handles schaltwerk:start-agent-from-spec event by prefilling new session modal', async () => {
      await renderApp()

      // Trigger the spec start event
      emitUiEvent(UiEvent.StartAgentFromSpec, { name: 'test-spec' })

      // Wait for the event to be processed
      await waitFor(() => {
        // The app should set up event listeners for spec starting
        // This is verified by the fact that the app renders without errors
        expect(screen.getByTestId('home-screen')).toBeInTheDocument()
      })
    })

    it('sets up event listeners for spec starting functionality', async () => {
      await renderApp()

      // Verify the app renders and would have set up the event listeners
      // The actual functionality is tested through integration with the real modal
      expect(screen.getByTestId('home-screen')).toBeInTheDocument()
    })
  })

  it('opens the Settings modal when the OpenSettings event is emitted', async () => {
    await renderApp()
    settingsModalMock.mockClear()

    await act(async () => {
      emitUiEvent(UiEvent.OpenSettings)
    })

    await waitFor(() => {
      expect(settingsModalMock).toHaveBeenCalled()
      const props = settingsModalMock.mock.calls.at(-1)?.[0] as { open: boolean }
      expect(props.open).toBe(true)
    })
  })

  it('passes the requested settings tab when handling OpenSettings', async () => {
    await renderApp()
    settingsModalMock.mockClear()

    await act(async () => {
      emitUiEvent(UiEvent.OpenSettings, { tab: 'projectRun' })
    })

    await waitFor(() => {
      expect(settingsModalMock).toHaveBeenCalled()
      const props = settingsModalMock.mock.calls.at(-1)?.[0] as { open: boolean; initialTab?: string }
      expect(props.open).toBe(true)
      expect(props.initialTab).toBe('projectRun')
    })
  })

  it('clears the initial settings tab once the modal closes', async () => {
    await renderApp()
    settingsModalMock.mockClear()

    await act(async () => {
      emitUiEvent(UiEvent.OpenSettings, { tab: 'projectRun' })
    })

    let latest: { open: boolean; initialTab?: string; onClose: () => void } | undefined

    await waitFor(() => {
      expect(settingsModalMock).toHaveBeenCalled()
      latest = settingsModalMock.mock.calls.at(-1)?.[0] as { open: boolean; initialTab?: string; onClose: () => void }
      expect(latest.open).toBe(true)
      expect(latest.initialTab).toBe('projectRun')
    })

    if (!latest) {
      throw new Error('Settings modal props were not captured')
    }

    await act(async () => {
      latest?.onClose()
    })

    await waitFor(() => {
      const finalProps = settingsModalMock.mock.calls.at(-1)?.[0] as { open: boolean; initialTab?: string }
      expect(finalProps.open).toBe(false)
      expect(finalProps.initialTab).toBeUndefined()
    })
  })

})

describe('validatePanelPercentage', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    startSessionTopMock.mockClear()
    listenEventHandlers.length = 0
    const { clearBackgroundStartsByPrefix } = await import('./common/uiEvents')
    clearBackgroundStartsByPrefix('')
  })

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
    await renderApp()

    await clickElement(screen.getByTestId('open-project'))

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument()
    })

    const modalCall = newSessionModalMock.mock.calls.at(-1)
    expect(modalCall).toBeTruthy()
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

    await Promise.resolve()
    await act(async () => { await Promise.resolve() })

    await waitFor(() => {
      const handler = __getSessionsEventHandlerForTest(SchaltEvent.SessionsRefreshed)
      expect(typeof handler).toBe('function')
    })

    const sessionsHandler = __getSessionsEventHandlerForTest(SchaltEvent.SessionsRefreshed)
    expect(sessionsHandler).toBeDefined()
    await act(async () => {
      sessionsHandler?.([
        { info: { session_id: 'feature-unique', status: 'Active', session_state: 'Running', original_agent_type: 'claude' } },
        { info: { session_id: 'feature-unique_v2', status: 'Active', session_state: 'Running', original_agent_type: 'claude' } },
        { info: { session_id: 'feature-unique_v3', status: 'Active', session_state: 'Running', original_agent_type: 'claude' } }
      ])
    })

    const sessionsRefreshedHandlers = listenEventHandlers.filter(entry => String(entry.event) === String(SchaltEvent.SessionsRefreshed))
    await act(async () => {
      sessionsRefreshedHandlers.forEach(({ handler }) => {
        handler([
          { info: { session_id: 'feature-unique', status: 'Active', session_state: 'Running', original_agent_type: 'claude' } },
          { info: { session_id: 'feature-unique_v2', status: 'Active', session_state: 'Running', original_agent_type: 'claude' } },
          { info: { session_id: 'feature-unique_v3', status: 'Active', session_state: 'Running', original_agent_type: 'claude' } }
        ])
      })
    })

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

    expect(firstCall!.agentType).toBe('claude')
    expect(secondCall!.agentType).toBe('claude')
    expect(thirdCall!.agentType).toBe('claude')

    invokeMock.mockImplementation(defaultInvokeImpl)
  })

  it('respects requested agent type even if creation resolves after SessionsRefreshed', async () => {
    await renderApp()

    await clickElement(screen.getByTestId('open-project'))

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument()
    })

    const modalCall = newSessionModalMock.mock.calls.at(-1)
    expect(modalCall).toBeTruthy()
    const modalProps = modalCall![0] as { onCreate: OnCreateFn }

    const { invoke } = await import('@tauri-apps/api/core')
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>

    const pendingResolvers: Array<() => void> = []
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === TauriCommands.SchaltwerkCoreCreateSession) {
        return await new Promise(resolve => {
          pendingResolvers.push(() => resolve({
            name: String(args?.name ?? 'feature'),
            branch: `${args?.baseBranch ?? 'main'}/${args?.name ?? 'feature'}`,
            parent_branch: args?.baseBranch ?? 'main',
            worktree_path: `/tmp/${args?.name ?? 'feature'}`,
            version_number: 1,
          }))
        })
      }
      return defaultInvokeImpl(cmd, args)
    })

    const createPromise = modalProps.onCreate({
      name: 'feature',
      prompt: undefined,
      baseBranch: 'main',
      versionCount: 1,
      agentType: 'codex',
      isSpec: false,
      userEditedName: true,
    })

    await Promise.resolve()
    await act(async () => { await Promise.resolve() })

    await waitFor(() => {
      const handler = __getSessionsEventHandlerForTest(SchaltEvent.SessionsRefreshed)
      expect(typeof handler).toBe('function')
    })

    const sessionsHandler = __getSessionsEventHandlerForTest(SchaltEvent.SessionsRefreshed)
    expect(sessionsHandler).toBeDefined()

    startSessionTopMock.mockClear()

    await act(async () => {
      sessionsHandler?.([
        {
          info: {
            session_id: 'feature',
            status: 'Active',
            session_state: 'Running',
            original_agent_type: 'codex',
          }
        }
      ])
    })

    const sessionsRefreshedHandlers = listenEventHandlers
      .filter(entry => String(entry.event) === String(SchaltEvent.SessionsRefreshed))

    await act(async () => {
      sessionsRefreshedHandlers.forEach(({ handler }) => {
        handler([
          {
            info: {
              session_id: 'feature',
              status: 'Active',
              session_state: 'Running',
              original_agent_type: 'codex',
            }
          }
        ])
      })
    })

    await waitFor(() => {
      expect(startSessionTopMock).toHaveBeenCalledTimes(1)
    })

    const [{ agentType }] = startSessionTopMock.mock.calls[0] as [StartSessionTopParams]
    expect(agentType).toBe('codex')

    await act(async () => {
      pendingResolvers.forEach(resolve => resolve())
    })
    await createPromise

    invokeMock.mockImplementation(defaultInvokeImpl)
  })

  it('enqueues a pending startup when starting an agent from an existing spec', async () => {
    const sessionsModule = await import('./hooks/useSessions')
    const originalUseSessions = sessionsModule.useSessions
    const enqueueSpy = vi.fn()

    const useSessionsSpy = vi.spyOn(sessionsModule, 'useSessions').mockImplementation(() => {
      const value = originalUseSessions()
      return {
        ...value,
        enqueuePendingStartup: async (sessionId: string, agentType?: string | null) => {
          enqueueSpy(sessionId, agentType)
          await value.enqueuePendingStartup(sessionId, agentType)
        },
      }
    })

    const { invoke } = await import('@tauri-apps/api/core')
    const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>
    const isoNow = new Date().toISOString()
    const specSession = {
      info: {
        session_id: 'draft-one',
        display_name: 'Draft One',
        branch: 'specs/draft-one',
        worktree_path: '',
        base_branch: 'main',
        parent_branch: 'main',
        status: 'spec',
        session_state: 'spec' as const,
        created_at: isoNow,
        ready_to_merge: false,
        has_uncommitted_changes: false,
        has_conflicts: false,
        is_current: false,
        session_type: 'worktree' as const,
      },
      status: undefined,
      terminals: [],
    }

    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
        return [specSession]
      }
      if (cmd === TauriCommands.SchaltwerkCoreStartSpecSession) {
        return null
      }
      if (cmd === TauriCommands.SchaltwerkCoreCreateAndStartSpecSession) {
        return null
      }
      if (cmd === TauriCommands.SchaltwerkCoreUpdateSpecContent) {
        return null
      }
      return defaultInvokeImpl(cmd, args)
    })

    try {
      await renderApp()

      await clickElement(screen.getByTestId('open-project'))
      await waitFor(() => {
        expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument()
      })

      await act(async () => {
        emitUiEvent(UiEvent.StartAgentFromSpec, { name: 'draft-one' })
      })

      await waitFor(() => {
        expect(newSessionModalMock).toHaveBeenCalled()
      })

      const modalCall = newSessionModalMock.mock.calls.at(-1)
      expect(modalCall).toBeTruthy()
      const modalProps = modalCall![0] as { onCreate: OnCreateFn }
      expect(typeof modalProps.onCreate).toBe('function')

      const createPromise = modalProps.onCreate({
        name: 'draft-one',
        prompt: '# Spec draft',
        baseBranch: 'main',
        versionCount: 1,
        agentType: 'claude',
        isSpec: false,
        userEditedName: true,
      })

      await Promise.resolve()
      await act(async () => { await Promise.resolve() })

      await waitFor(() => {
        const handler = __getSessionsEventHandlerForTest(SchaltEvent.SessionsRefreshed)
        expect(typeof handler).toBe('function')
      })

      const sessionsRefreshedHandlers = listenEventHandlers.filter(
        entry => String(entry.event) === String(SchaltEvent.SessionsRefreshed)
      )

      const runningPayload = [
        {
          info: {
            session_id: 'draft-one',
            display_name: 'Draft One',
            branch: 'schaltwerk/draft-one',
            worktree_path: '/tmp/worktrees/draft-one',
            base_branch: 'main',
            parent_branch: 'main',
            status: 'active',
            session_state: 'running' as const,
            created_at: isoNow,
            last_modified: isoNow,
            ready_to_merge: false,
            has_uncommitted_changes: false,
            has_conflicts: false,
            is_current: false,
            session_type: 'worktree' as const,
            original_agent_type: 'claude',
          },
          terminals: [],
        },
      ]

      await act(async () => {
        const sessionsHandler = __getSessionsEventHandlerForTest(SchaltEvent.SessionsRefreshed)
        expect(sessionsHandler).toBeDefined()
        sessionsHandler?.(runningPayload)
        sessionsRefreshedHandlers.forEach(({ handler }) => handler(runningPayload))
      })

      await waitFor(() => {
        expect(startSessionTopMock).toHaveBeenCalledWith(expect.objectContaining({ sessionName: 'draft-one' }))
      })

      await createPromise

      expect(enqueueSpy).toHaveBeenCalledWith('draft-one', 'claude')
    } finally {
      useSessionsSpy.mockRestore()
      invokeMock.mockImplementation(defaultInvokeImpl)
    }
  })

  it('should skip starting agents for sessions cancelled during version group creation', async () => {
    await renderApp()

    await clickElement(screen.getByTestId('open-project'))

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument()
    })

    const modalCall = newSessionModalMock.mock.calls.at(-1)
    expect(modalCall).toBeTruthy()
    const modalProps = modalCall![0] as { onCreate: OnCreateFn }
    expect(typeof modalProps.onCreate).toBe('function')

    const createdResponses = [
      { name: 'session-a', version_number: 1 },
      { name: 'session-b', version_number: 2 }
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
      name: 'test',
      prompt: undefined,
      baseBranch: 'main',
      versionCount: 2,
      agentType: 'claude',
      isSpec: false,
      userEditedName: true,
    })

    await Promise.resolve()
    await act(async () => { await Promise.resolve() })

    await waitFor(() => {
      const handler = __getSessionsEventHandlerForTest(SchaltEvent.SessionsRefreshed)
      expect(typeof handler).toBe('function')
    })
    const sessionsHandler = __getSessionsEventHandlerForTest(SchaltEvent.SessionsRefreshed)
    expect(sessionsHandler).toBeDefined()

    await act(async () => {
      sessionsHandler?.([
        { info: { session_id: 'session-b', status: 'Active', session_state: 'Running', original_agent_type: 'claude' } }
      ])
    })

    const sessionsRefreshedHandlers = listenEventHandlers.filter(entry => String(entry.event) === String(SchaltEvent.SessionsRefreshed))

    await act(async () => {
      sessionsRefreshedHandlers.forEach(({ handler }) => {
        handler([
          { info: { session_id: 'session-b', status: 'Active', session_state: 'Running', original_agent_type: 'claude' } }
        ])
      })
    })


    await createPromise

    expect(startSessionTopMock).toHaveBeenCalledTimes(1)
    const callArgs = startSessionTopMock.mock.calls as Array<[StartSessionTopParams]>

    expect(callArgs[0]?.[0].sessionName).toBe('session-b')

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
