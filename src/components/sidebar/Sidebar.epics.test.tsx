import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { EnrichedSession, SessionInfo } from '../../types/session'

vi.mock('@tauri-apps/api/core')

let eventHandlers: Record<string, ((_event: unknown) => void)[]> = {}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((event: string, handler: (_event: unknown) => void) => {
    if (!eventHandlers[event]) {
      eventHandlers[event] = []
    }
    eventHandlers[event].push(handler)
    return Promise.resolve(() => {
      eventHandlers[event] = eventHandlers[event].filter(h => h !== handler)
    })
  }),
  emit: vi.fn(),
}))

const createSession = (id: string, overrides: Partial<SessionInfo> = {}): EnrichedSession => ({
  info: {
    session_id: id,
    branch: `para/${id}`,
    worktree_path: `/path/${id}`,
    base_branch: 'main',
    status: 'active',
    is_current: false,
    session_type: 'worktree',
    session_state: 'running',
    ...overrides,
  } as SessionInfo,
  terminals: [],
})

describe('Sidebar epic grouping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    eventHandlers = {}

    const epic = { id: 'epic-1', name: 'billing-v2', color: 'blue' }

    const sessions: EnrichedSession[] = [
      createSession('billing-handler', { epic } as unknown as Partial<SessionInfo>),
      createSession('billing-ui', { epic } as unknown as Partial<SessionInfo>),
      createSession('spec-one', { status: 'spec', session_state: 'spec', epic } as unknown as Partial<SessionInfo>),
      createSession('lonely-session'),
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentBranchName) return 'main'
      if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all' }
      if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.GetCurrentDirectory) return '/test/dir'
      return undefined
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders epic headers and ungrouped section', async () => {
    render(
      <TestProviders>
        <Sidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByText('billing-handler')).toBeInTheDocument()
    })

    expect(screen.getByTestId('epic-header-epic-1')).toHaveTextContent('billing-v2')
    expect(screen.getByTestId('epic-ungrouped-header')).toHaveTextContent('Ungrouped')
  })
})
