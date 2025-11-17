import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, screen, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { invoke } from '@tauri-apps/api/core'
import type { EnrichedSession } from '../../types/session'
import type { MockTauriInvokeArgs } from '../../types/testing'

vi.mock('@tauri-apps/api/core')
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

const createSession = (id: string, createdAt: string, readyToMerge = false): EnrichedSession => ({
  info: {
    session_id: id,
    branch: `schaltwerk/${id}`,
    worktree_path: `/path/${id}`,
    base_branch: 'main',
    status: 'active' as const,
    created_at: createdAt,
    last_modified: createdAt,
    has_uncommitted_changes: false,
    is_current: false,
    session_type: 'worktree',
    ready_to_merge: readyToMerge,
    session_state: readyToMerge ? 'reviewed' : 'running',
  },
  terminals: [],
})

describe('Sidebar creation-date sorting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('always orders running/spec sessions by creation date descending', async () => {
    const sessions = [
      createSession('alpha_session', '2024-01-01T10:00:00Z'),
      createSession('zebra_session', '2024-01-02T12:00:00Z'),
      createSession('beta_session', '2023-12-31T09:00:00Z'),
      createSession('reviewed_session', '2024-01-03T08:00:00Z', true),
    ]

    vi.mocked(invoke).mockImplementation(async (cmd: string, _args?: MockTauriInvokeArgs) => {
      switch (cmd) {
        case TauriCommands.SchaltwerkCoreListEnrichedSessions:
          return sessions
        case TauriCommands.SchaltwerkCoreListSessionsByState:
          return []
        case TauriCommands.GetProjectSessionsSettings:
          return { filter_mode: 'all' }
        case TauriCommands.SetProjectSessionsSettings:
          return undefined
        case TauriCommands.GetCurrentDirectory:
          return '/tmp'
        case TauriCommands.TerminalExists:
          return false
        case TauriCommands.CreateTerminal:
          return true
        case 'get_buffer':
          return ''
        default:
          return undefined
      }
    })

    render(
      <TestProviders>
        <Sidebar />
      </TestProviders>,
    )

    await waitFor(() => {
      expect(screen.getAllByRole('button').some(btn => btn.textContent?.includes('schaltwerk/alpha_session'))).toBe(true)
    })

    const orderedButtons = screen.getAllByRole('button').filter(btn => {
      const label = btn.textContent || ''
      return label.includes('schaltwerk/') && !label.includes('main (orchestrator)')
    })

    expect(orderedButtons.map(btn => btn.textContent)).toEqual([
      expect.stringContaining('zebra_session'),
      expect.stringContaining('alpha_session'),
      expect.stringContaining('beta_session'),
      expect.stringContaining('reviewed_session'),
    ])
  })
})
