import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}))

import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { SessionState, type EnrichedSession, type RawSession } from '../../types/session'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { useSelection } from '../../hooks/useSelection'
import { useSessions } from '../../hooks/useSessions'
import { FilterMode } from '../../types/sessionFilters'

const mockInvoke = invoke as MockedFunction<typeof invoke>

function createRawSession(
  name: string,
  worktreePath: string,
  state: SessionState,
  readyToMerge: boolean
): RawSession {
  const now = new Date().toISOString()
  return {
    id: `${name}-id`,
    name,
    display_name: name,
    repository_path: '/test/project',
    repository_name: 'project',
    branch: `${name}-branch`,
    parent_branch: 'main',
    worktree_path: worktreePath,
    status: state === SessionState.Spec ? 'spec' : 'active',
    created_at: now,
    updated_at: now,
    ready_to_merge: readyToMerge,
    pending_name_generation: false,
    was_auto_generated: false,
    session_state: state,
  }
}

function createEnrichedSession(
  name: string,
  worktreePath: string,
  state: SessionState,
  readyToMerge: boolean
): EnrichedSession {
  const now = new Date().toISOString()
  return {
    info: {
      session_id: name,
      display_name: name,
      branch: `${name}-branch`,
      worktree_path: worktreePath,
      base_branch: 'main',
      parent_branch: 'main',
      status: state === SessionState.Spec ? 'spec' : 'active',
      created_at: now,
      last_modified: now,
      has_uncommitted_changes: false,
      is_current: false,
      session_type: 'worktree',
      session_state: state,
      ready_to_merge: readyToMerge,
    },
    status: undefined,
    terminals: [],
  }
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <TestProviders>
    <Sidebar />
    {children}
  </TestProviders>
)

describe('Sidebar selection transitions', () => {
  let enrichedSessions: EnrichedSession[]
  const rawSessions: Record<string, RawSession> = {}
  const terminalIds = new Set<string>()

  beforeEach(() => {
    vi.clearAllMocks()
    enrichedSessions = []
    Object.keys(rawSessions).forEach(key => delete rawSessions[key])
    terminalIds.clear()

    mockInvoke.mockImplementation((command: string, args?: Record<string, unknown> | number[] | ArrayBuffer | Uint8Array) => {
      const isRecord = (a: typeof args): a is Record<string, unknown> => {
        return a != null && typeof a === 'object' && !Array.isArray(a) && !(a instanceof ArrayBuffer) && !(a instanceof Uint8Array)
      }
      switch (command) {
        case TauriCommands.GetCurrentDirectory:
          return Promise.resolve('/test/project')
        case TauriCommands.TerminalExists: {
          const id = isRecord(args) ? args.id as string | undefined : undefined
          return Promise.resolve(id ? terminalIds.has(id) : false)
        }
        case TauriCommands.CreateTerminal:
        case TauriCommands.CreateTerminalWithSize: {
          const id = isRecord(args) ? args.id as string | undefined : undefined
          if (id) terminalIds.add(id)
          return Promise.resolve()
        }
        case TauriCommands.CloseTerminal: {
          const id = isRecord(args) ? args.id as string | undefined : undefined
          if (id) terminalIds.delete(id)
          return Promise.resolve()
        }
        case TauriCommands.PathExists:
        case TauriCommands.DirectoryExists:
          return Promise.resolve(true)
        case TauriCommands.SchaltwerkCoreListEnrichedSessions:
          return Promise.resolve(enrichedSessions)
        case TauriCommands.SchaltwerkCoreListSessionsByState:
          return Promise.resolve([])
        case TauriCommands.SchaltwerkCoreGetSession: {
          const name = isRecord(args) ? args.name as string | undefined : undefined
          if (name && rawSessions[name]) {
            return Promise.resolve(rawSessions[name])
          }
          return Promise.reject(new Error('Session not found'))
        }
        case TauriCommands.GetProjectSessionsSettings:
          return Promise.resolve({ filter_mode: 'running', sort_mode: 'name' })
        case TauriCommands.GetCurrentBranchName:
          return Promise.resolve('main')
        default:
          return Promise.resolve(null)
      }
    })
  })

  it('advances to the next running session when the current one is marked reviewed under Running filter', async () => {
    const sessionA = createEnrichedSession('session-a', '/worktrees/a', SessionState.Running, false)
    const sessionB = createEnrichedSession('session-b', '/worktrees/b', SessionState.Running, false)
    enrichedSessions = [sessionA, sessionB]
    rawSessions['session-a'] = createRawSession('session-a', '/worktrees/a', SessionState.Running, false)
    rawSessions['session-b'] = createRawSession('session-b', '/worktrees/b', SessionState.Running, false)

    const { result } = renderHook(() => ({
      selectionCtx: useSelection(),
      sessionsCtx: useSessions(),
    }), { wrapper })

    await waitFor(() => {
      expect(result.current.selectionCtx.isReady).toBe(true)
    })

    await waitFor(() => {
      expect(result.current.sessionsCtx.filterMode).toBe(FilterMode.Running)
    })

    await act(async () => {
      await result.current.selectionCtx.setSelection({
        kind: 'session',
        payload: 'session-a',
        sessionState: 'running',
        worktreePath: '/worktrees/a',
      })
    })

    await waitFor(() => {
      expect(result.current.selectionCtx.selection.payload).toBe('session-a')
    })

    const reviewedA = createEnrichedSession('session-a', '/worktrees/a', SessionState.Running, true)
    enrichedSessions = [reviewedA, sessionB]
    rawSessions['session-a'] = createRawSession('session-a', '/worktrees/a', SessionState.Running, true)

    await act(async () => {
      await result.current.sessionsCtx.reloadSessions()
    })

    await waitFor(() => {
      const visible = result.current.sessionsCtx.sessions.map(session => ({
        id: session.info.session_id,
        ready: session.info.ready_to_merge,
      }))
      const runningIds = visible
        .filter(session => !session.ready)
        .map(session => session.id)
      expect(runningIds).toContain('session-b')
      expect(runningIds).not.toContain('session-a')
    })

    await waitFor(() => {
      expect(result.current.selectionCtx.selection.payload).toBe('session-b')
    })
    expect(result.current.selectionCtx.selection.kind).toBe('session')
  })
})
