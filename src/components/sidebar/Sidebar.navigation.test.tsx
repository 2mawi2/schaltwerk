import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, waitFor, screen, fireEvent, act } from '@testing-library/react'
import type { Event } from '@tauri-apps/api/event'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import type { EnrichedSession } from '../../types/session'

const mockResetSession = vi.fn()
const mockSwitchModel = vi.fn()
const mockGetAgentType = vi.fn().mockResolvedValue('claude')

vi.mock('../../hooks/useSessionManagement', () => ({
  useSessionManagement: () => ({
    isResetting: false,
    resetSession: mockResetSession,
    switchModel: mockSwitchModel,
  }),
}))

vi.mock('../../hooks/useClaudeSession', () => ({
  useClaudeSession: () => ({
    getAgentType: mockGetAgentType,
    setAgentType: vi.fn(),
    startClaude: vi.fn(),
    getSkipPermissions: vi.fn(),
    setSkipPermissions: vi.fn(),
    getOrchestratorAgentType: vi.fn().mockResolvedValue('claude'),
    setOrchestratorAgentType: vi.fn(),
    getOrchestratorSkipPermissions: vi.fn(),
    setOrchestratorSkipPermissions: vi.fn(),
  }),
}))

vi.mock('../../hooks/useAgentAvailability', () => ({
  useAgentAvailability: () => ({
    isAvailable: vi.fn().mockReturnValue(true),
    getRecommendedPath: vi.fn().mockReturnValue(null),
    getInstallationMethod: vi.fn().mockReturnValue(null),
    loading: false,
    availability: {},
    refreshAvailability: vi.fn(),
    refreshSingleAgent: vi.fn(),
    clearCache: vi.fn(),
    forceRefresh: vi.fn(),
  }),
  InstallationMethod: {
    Homebrew: 'Homebrew',
    Npm: 'Npm',
    Pip: 'Pip',
    Manual: 'Manual',
    System: 'System',
  },
}))

// Do NOT mock useKeyboardShortcuts here; we want real keyboard behavior

// Mock tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
  UnlistenFn: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// Mock the useProject hook to provide a project path
vi.mock('../../contexts/ProjectContext', async () => {
    const actual = await vi.importActual<typeof import('../../contexts/ProjectContext')>('../../contexts/ProjectContext')
    return {
        ...actual,
        useProject: () => ({
            projectPath: '/test/project',
            setProjectPath: vi.fn()
        })
    }
})

const mockInvoke = vi.mocked(invoke)
const mockListen = vi.mocked(listen)
const mockUnlisten = vi.fn()


function pressKey(key: string, { metaKey = false, ctrlKey = false, shiftKey = false, altKey = false } = {}) {
  const event = new KeyboardEvent('keydown', { key, metaKey, ctrlKey, shiftKey, altKey })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

let sessionsFixture: EnrichedSession[]

describe('Sidebar navigation with arrow keys including orchestrator', () => {
  let eventListeners: Map<string, (event: Event<unknown>) => void>

  beforeEach(() => {
    vi.clearAllMocks()
    mockResetSession.mockReset()
    mockResetSession.mockResolvedValue(undefined)
    mockSwitchModel.mockReset()
    mockSwitchModel.mockResolvedValue(undefined)
    mockGetAgentType.mockReset()
    mockGetAgentType.mockResolvedValue('claude')
    eventListeners = new Map()

    // Simulate mac for meta key
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', configurable: true })

    sessionsFixture = [
      {
        info: {
          session_id: 's1',
          branch: 'feature/one',
          worktree_path: '/path/one',
          base_branch: 'main',
          status: 'active',
          is_current: false,
          session_type: 'worktree',
          session_state: 'running',
        },
        status: undefined,
        terminals: []
      },
      {
        info: {
          session_id: 's2',
          branch: 'feature/two',
          worktree_path: '/path/two',
          base_branch: 'main',
          status: 'active',
          is_current: false,
          session_type: 'worktree',
          session_state: 'running',
        },
        status: undefined,
        terminals: []
      }
    ]

    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case TauriCommands.SchaltwerkCoreListEnrichedSessions:
          return Promise.resolve(sessionsFixture)
        case TauriCommands.SchaltwerkCoreListSessionsByState:
          return Promise.resolve([])
        case TauriCommands.GetCurrentDirectory:
          return Promise.resolve('/test/cwd')
        case TauriCommands.GetProjectSessionsSettings:
          return Promise.resolve({ filter_mode: 'all', sort_mode: 'name' })
        case TauriCommands.TerminalExists:
          return Promise.resolve(false)
        case TauriCommands.CreateTerminal:
          return Promise.resolve()
        case TauriCommands.SchaltwerkCoreGetAgentType:
          return Promise.resolve('claude')
        default:
          return Promise.resolve()
      }
    })

    mockListen.mockImplementation((event: string, handler: (event: Event<unknown>) => void) => {
      eventListeners.set(event, handler)
      return Promise.resolve(mockUnlisten)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    eventListeners.clear()
  })

  it('ArrowDown from orchestrator selects the first session', async () => {
    const { getByLabelText, queryByLabelText, findAllByLabelText } = render(<TestProviders><Sidebar /></TestProviders>)

    // Wait for sessions to load and render buttons
    await findAllByLabelText(/Select session \(⌘/i)

    // Orchestrator initially selected
    const orchestratorBtn = getByLabelText(/Select orchestrator/i)
    await waitFor(() => {
      expect(orchestratorBtn.className).toContain('session-ring-blue')
    })

    // Press Cmd+ArrowDown
    pressKey('ArrowDown', { metaKey: true })

    // Expect some session to be selected (button title changes when selected)
    await waitFor(() => {
      expect(getByLabelText(/Selected session/i)).toBeTruthy()
    })

    // Orchestrator not selected anymore
    await waitFor(() => {
      expect(queryByLabelText(/Select orchestrator/i)?.className || '').not.toContain('session-ring-blue')
    })
  })

  it('ArrowUp from first session selects orchestrator', async () => {
    const { getByLabelText, findAllByLabelText } = render(<TestProviders><Sidebar /></TestProviders>)

    // Wait for sessions to load
    await findAllByLabelText(/Select session \(⌘/i)

    // Move to first session first
    pressKey('ArrowDown', { metaKey: true })

    await waitFor(() => {
      expect(getByLabelText(/Selected session/i)).toBeTruthy()
    })

    // Press Cmd+ArrowUp
    pressKey('ArrowUp', { metaKey: true })

    const orchestratorBtn = getByLabelText(/Select orchestrator/i)
    await waitFor(() => {
      expect(orchestratorBtn.className).toContain('session-ring-blue')
    })
  })

  it('Cmd+Y resets the orchestrator selection', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => expect(mockResetSession).not.toHaveBeenCalled())

    pressKey('y', { metaKey: true })

    expect(mockResetSession).toHaveBeenCalledTimes(1)
    const [selectionArg, terminalsArg] = mockResetSession.mock.calls[0]
    expect(selectionArg).toMatchObject({ kind: 'orchestrator' })
    expect(terminalsArg).toHaveProperty('top')
  })

  it('Cmd+Y resets a running session', async () => {
    const { findAllByLabelText } = render(<TestProviders><Sidebar /></TestProviders>)

    await findAllByLabelText(/Select session \(⌘/i)

    pressKey('ArrowDown', { metaKey: true })

    pressKey('y', { metaKey: true })

    await waitFor(() => {
      expect(mockResetSession).toHaveBeenCalled()
    })

    const [selectionArg] = mockResetSession.mock.calls[0]
    expect(selectionArg).toMatchObject({ kind: 'session', payload: 's1' })
  })

  it('Cmd+P opens switch model modal for orchestrator', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    pressKey('p', { metaKey: true })

    await waitFor(() => {
      expect(screen.getByText('Switch Orchestrator Agent')).toBeInTheDocument()
    })
  })

  it('Cmd+P opens switch model modal for a session and confirms switch', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => expect(mockSwitchModel).not.toHaveBeenCalled())

    // Select first session (running)
    pressKey('ArrowDown', { metaKey: true })
    await new Promise(resolve => setTimeout(resolve, 25))

    pressKey('p', { metaKey: true })

    await waitFor(() => {
      expect(screen.getByText('Switch Orchestrator Agent')).toBeInTheDocument()
    })

    const switchBtn = await screen.findByRole('button', { name: /switch agent/i })
    fireEvent.click(switchBtn)

    await waitFor(() => {
      expect(mockSwitchModel).toHaveBeenCalled()
    })

    const [agentType] = mockSwitchModel.mock.calls[0]
    expect(typeof agentType).toBe('string')
  })
})
