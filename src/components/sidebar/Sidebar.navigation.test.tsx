import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, waitFor } from '@testing-library/react'
import type { Event } from '@tauri-apps/api/event'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'

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


function pressKey(key: string, { metaKey = false, ctrlKey = false, shiftKey = false } = {}) {
  const event = new KeyboardEvent('keydown', { key, metaKey, ctrlKey, shiftKey })
  window.dispatchEvent(event)
}

describe('Sidebar navigation with arrow keys including orchestrator', () => {
  let eventListeners: Map<string, (event: Event<unknown>) => void>

  beforeEach(() => {
    vi.clearAllMocks()
    eventListeners = new Map()

    // Simulate mac for meta key
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', configurable: true })

    const sessions = [
      {
        info: {
          session_id: 's1',
          branch: 'feature/one',
          worktree_path: '/path/one',
          base_branch: 'main',
          status: 'active',
          is_current: false,
          session_type: 'worktree',
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
        },
        status: undefined,
        terminals: []
      }
    ]

    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case TauriCommands.SchaltwerkCoreListEnrichedSessions:
          return Promise.resolve(sessions)
        case TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted:
          return Promise.resolve(sessions)
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
    const { getByTitle, queryByTitle, findAllByTitle } = render(<TestProviders><Sidebar /></TestProviders>)

    // Wait for sessions to load and render buttons
    await findAllByTitle(/Select session \(⌘/i)

    // Orchestrator initially selected
    const orchestratorBtn = getByTitle(/Select orchestrator/i)
    await waitFor(() => {
      expect(orchestratorBtn.className).toContain('session-ring-blue')
    })

    // Press Cmd+ArrowDown
    pressKey('ArrowDown', { metaKey: true })

    // Expect some session to be selected (button title changes when selected)
    await waitFor(() => {
      expect(getByTitle(/Selected session/i)).toBeTruthy()
    })

    // Orchestrator not selected anymore
    await waitFor(() => {
      expect(queryByTitle(/Select orchestrator/i)?.className || '').not.toContain('session-ring-blue')
    })
  })

  it('ArrowUp from first session selects orchestrator', async () => {
    const { getByTitle, findAllByTitle } = render(<TestProviders><Sidebar /></TestProviders>)

    // Wait for sessions to load
    await findAllByTitle(/Select session \(⌘/i)

    // Move to first session first
    pressKey('ArrowDown', { metaKey: true })

    await waitFor(() => {
      expect(getByTitle(/Selected session/i)).toBeTruthy()
    })

    // Press Cmd+ArrowUp
    pressKey('ArrowUp', { metaKey: true })

    const orchestratorBtn = getByTitle(/Select orchestrator/i)
    await waitFor(() => {
      expect(orchestratorBtn.className).toContain('session-ring-blue')
    })
  })
})
