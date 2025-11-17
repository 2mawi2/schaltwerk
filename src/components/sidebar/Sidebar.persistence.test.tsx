import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { invoke } from '@tauri-apps/api/core'
import { FilterMode } from '../../types/sessionFilters'
import type { EnrichedSession } from '../../types/session'
import type { MockTauriInvokeArgs } from '../../types/testing'

vi.mock('@tauri-apps/api/core')
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

const createSession = (id: string, createdAt: string, readyToMerge = false): EnrichedSession => ({
  info: {
    session_id: id,
    branch: `para/${id}`,
    worktree_path: `/path/${id}`,
    base_branch: 'main',
    status: 'active' as const,
    created_at: createdAt,
    has_uncommitted_changes: false,
    is_current: false,
    session_type: 'worktree',
    session_state: readyToMerge ? 'reviewed' : 'running',
    ready_to_merge: readyToMerge,
  },
  terminals: [],
})

describe('Sidebar session ordering and persistence', () => {
  let savedFilterMode: string = FilterMode.All
  let lastPersistedSettings: Record<string, unknown> | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    savedFilterMode = FilterMode.All
    lastPersistedSettings = null

    const sessions = [
      createSession('test_session_a', '2024-01-01T10:00:00Z'),
      createSession('test_session_b', '2024-01-02T10:00:00Z'),
      createSession('test_session_c', '2023-12-31T10:00:00Z'),
      createSession('reviewed_session', '2024-01-03T10:00:00Z', true),
    ]

    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: MockTauriInvokeArgs) => {
      switch (cmd) {
        case TauriCommands.SchaltwerkCoreListEnrichedSessions:
          return sessions
        case TauriCommands.SchaltwerkCoreListSessionsByState:
          return []
        case TauriCommands.GetCurrentDirectory:
          return '/test/dir'
        case TauriCommands.TerminalExists:
          return false
        case TauriCommands.CreateTerminal:
          return true
        case 'get_buffer':
          return ''
        case TauriCommands.GetProjectSessionsSettings:
          return { filter_mode: savedFilterMode, sort_mode: 'legacy-name' }
        case TauriCommands.SetProjectSessionsSettings: {
          const incoming = (args as { settings?: { filter_mode?: string } })?.settings ?? {}
          savedFilterMode = incoming.filter_mode || savedFilterMode
          lastPersistedSettings = incoming
          return undefined
        }
        default:
          return undefined
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sorts sessions by creation date while keeping reviewed sessions last', async () => {
    render(
      <TestProviders>
        <Sidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      const sessionButtons = screen.getAllByRole('button').filter(btn => {
        const text = btn.textContent || ''
        return text.includes('para/') && !text.includes('main (orchestrator)')
      })
      expect(sessionButtons).toHaveLength(4)
    })

    const orderedButtons = screen.getAllByRole('button').filter(btn => {
      const text = btn.textContent || ''
      return text.includes('para/') && !text.includes('main (orchestrator)')
    })

    expect(orderedButtons[0]).toHaveTextContent('test_session_b') // newest unreviewed
    expect(orderedButtons[1]).toHaveTextContent('test_session_a')
    expect(orderedButtons[2]).toHaveTextContent('test_session_c') // oldest unreviewed
    expect(orderedButtons[3]).toHaveTextContent('reviewed_session') // reviewed pinned last
  })

  it('persists filter mode changes without emitting legacy sort state', async () => {
    render(
      <TestProviders>
        <Sidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getByTitle('Show spec agents')).toBeInTheDocument()
    })

    const specsButton = screen.getByTitle('Show spec agents')
    fireEvent.click(specsButton)

    await waitFor(() => {
      expect(savedFilterMode).toBe(FilterMode.Spec)
      expect(lastPersistedSettings).toEqual({ filter_mode: FilterMode.Spec })
    })
  })
})
