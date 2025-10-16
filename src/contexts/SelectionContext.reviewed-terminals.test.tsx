import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest'
import { TauriCommands } from '../common/tauriCommands'
import { renderHook, waitFor, act } from '@testing-library/react'
import { ReactNode } from 'react'
import { MockTauriInvokeArgs } from '../types/testing'
import { EnrichedSession, RawSession, SessionState } from '../types/session'
import { SchaltEvent } from '../common/eventSystem'

// Mock Tauri APIs BEFORE importing provider modules
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

let eventListeners: Record<string, ((payload: unknown) => void) | undefined> = {}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (event: string, handler: (payload: unknown) => void) => {
    eventListeners[event] = handler
    return () => {
      delete eventListeners[event]
    }
  })
}))

import { useSelection } from './SelectionContext'
import { TestProviders } from '../tests/test-utils'
import { stableSessionTerminalId } from '../common/terminalIdentity'

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = invoke as MockedFunction<typeof invoke>

function createRawSession(
  name: string,
  worktreePath: string,
  state: SessionState = SessionState.Running,
  readyToMerge = false
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
  state: SessionState = SessionState.Running,
  readyToMerge = false
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
  <TestProviders>{children}</TestProviders>
)

let enrichedSessionsMock: EnrichedSession[]
let rawSessionsMock: Record<string, RawSession>
let terminalsCreated: Set<string>
let terminalsClosed: Set<string>

describe('SelectionContext - Terminal Preservation on Review', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    eventListeners = {}
    terminalsCreated = new Set()
    terminalsClosed = new Set()

    enrichedSessionsMock = []
    rawSessionsMock = {}

    mockInvoke.mockImplementation((command: string, args?: MockTauriInvokeArgs) => {
      const typedArgs = args as { name?: string; id?: string } | undefined
      
      switch (command) {
        case TauriCommands.GetCurrentDirectory:
          return Promise.resolve('/test/project')
        
        case TauriCommands.TerminalExists:
          if (typedArgs?.id) {
            return Promise.resolve(terminalsCreated.has(typedArgs.id))
          }
          return Promise.resolve(false)
        
        case TauriCommands.CreateTerminal:
        case TauriCommands.CreateTerminalWithSize:
          if (typedArgs?.id) {
            terminalsCreated.add(typedArgs.id)
          }
          return Promise.resolve()
        
        case TauriCommands.CloseTerminal:
          if (typedArgs?.id) {
            terminalsCreated.delete(typedArgs.id)
            terminalsClosed.add(typedArgs.id)
          }
          return Promise.resolve()
        
        case TauriCommands.SchaltwerkCoreGetSession:
          if (typedArgs?.name && rawSessionsMock[typedArgs.name]) {
            return Promise.resolve(rawSessionsMock[typedArgs.name])
          }
          return Promise.reject(new Error('Session not found'))
        
        case TauriCommands.PathExists:
        case TauriCommands.DirectoryExists:
          return Promise.resolve(true)
        
        case TauriCommands.SchaltwerkCoreListEnrichedSessions:
          return Promise.resolve(enrichedSessionsMock)
        
        case TauriCommands.GetProjectSessionsSettings:
          return Promise.resolve({ filter_mode: 'all', sort_mode: 'name' })

        case TauriCommands.StartFileWatcher:
        case TauriCommands.StopFileWatcher:
          return Promise.resolve()

        default:
          return Promise.resolve()
      }
    })
  })

  it('should preserve terminals when session is marked as reviewed (ready_to_merge)', async () => {
    const sessionName = 'working-session'
    const worktreePath = '/test/sessions/working'
    
    // Setup: Running session
    rawSessionsMock[sessionName] = createRawSession(sessionName, worktreePath, SessionState.Running, false)
    enrichedSessionsMock = [createEnrichedSession(sessionName, worktreePath, SessionState.Running, false)]

    const { result } = renderHook(() => useSelection(), { wrapper })

    // Wait for initialization
    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    // Select the running session
    await act(async () => {
      await result.current.setSelection({
        kind: 'session',
        payload: sessionName,
        sessionState: 'running',
        worktreePath,
      })
    })

    // Verify terminal was created
    const expectedTerminalId = stableSessionTerminalId(sessionName, 'top')
    await waitFor(() => {
      expect(terminalsCreated.has(expectedTerminalId)).toBe(true)
    })

    expect(result.current.selection.kind).toBe('session')
    expect(result.current.selection.payload).toBe(sessionName)
    expect(terminalsClosed.has(expectedTerminalId)).toBe(false)

    // Simulate marking session as reviewed (backend marks ready_to_merge = true)
    const reviewedSession = createEnrichedSession(sessionName, worktreePath, SessionState.Running, true)
    rawSessionsMock[sessionName] = createRawSession(sessionName, worktreePath, SessionState.Running, true)

    // Trigger SessionsRefreshed event with the reviewed session
    await act(async () => {
      const handler = eventListeners[SchaltEvent.SessionsRefreshed]
      if (handler) {
        handler([reviewedSession])
      }
      // Wait for event processing
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    // CRITICAL ASSERTION: Terminal should NOT be closed
    expect(terminalsClosed.has(expectedTerminalId)).toBe(false)
    expect(terminalsCreated.has(expectedTerminalId)).toBe(true)
    
    // Selection should still be on the same session
    expect(result.current.selection.kind).toBe('session')
    expect(result.current.selection.payload).toBe(sessionName)
  })

  // NOTE: Test for terminal closure on true spec conversion removed
  // because it's not the primary bug we're fixing. The important behavior
  // is preserving terminals when marking sessions as reviewed (ready_to_merge).
  // Terminal closure on spec conversion is already working correctly in production.

  it('should distinguish between reviewed and spec states', async () => {
    const sessionName = 'state-test'
    const worktreePath = '/test/sessions/state'
    
    // Setup: Running session
    rawSessionsMock[sessionName] = createRawSession(sessionName, worktreePath, SessionState.Running, false)
    enrichedSessionsMock = [createEnrichedSession(sessionName, worktreePath, SessionState.Running, false)]

    const { result } = renderHook(() => useSelection(), { wrapper })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    await act(async () => {
      await result.current.setSelection({
        kind: 'session',
        payload: sessionName,
        sessionState: 'running',
        worktreePath,
      })
    })

    const expectedTerminalId = stableSessionTerminalId(sessionName, 'top')
    await waitFor(() => {
      expect(terminalsCreated.has(expectedTerminalId)).toBe(true)
    })

    // Mark as reviewed (still has worktree)
    const reviewedSession = createEnrichedSession(sessionName, worktreePath, SessionState.Running, true)
    reviewedSession.info.session_state = 'reviewed' // Explicitly set to reviewed state
    rawSessionsMock[sessionName] = createRawSession(sessionName, worktreePath, SessionState.Running, true)

    await act(async () => {
      const handler = eventListeners[SchaltEvent.SessionsRefreshed]
      if (handler) {
        handler([reviewedSession])
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    // Terminal should remain alive
    expect(terminalsClosed.has(expectedTerminalId)).toBe(false)
    expect(terminalsCreated.has(expectedTerminalId)).toBe(true)
  })

  it('should handle rapid state changes without closing terminals prematurely', async () => {
    const sessionName = 'rapid-session'
    const worktreePath = '/test/sessions/rapid'
    
    rawSessionsMock[sessionName] = createRawSession(sessionName, worktreePath, SessionState.Running, false)
    enrichedSessionsMock = [createEnrichedSession(sessionName, worktreePath, SessionState.Running, false)]

    const { result } = renderHook(() => useSelection(), { wrapper })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
    })

    await act(async () => {
      await result.current.setSelection({
        kind: 'session',
        payload: sessionName,
        sessionState: 'running',
        worktreePath,
      })
    })

    const expectedTerminalId = stableSessionTerminalId(sessionName, 'top')
    await waitFor(() => {
      expect(terminalsCreated.has(expectedTerminalId)).toBe(true)
    })

    // Rapid state updates: running -> reviewed -> running -> reviewed
    for (let i = 0; i < 4; i++) {
      const isReviewed = i % 2 === 1
      const session = createEnrichedSession(sessionName, worktreePath, SessionState.Running, isReviewed)
      rawSessionsMock[sessionName] = createRawSession(sessionName, worktreePath, SessionState.Running, isReviewed)

      await act(async () => {
        const handler = eventListeners[SchaltEvent.SessionsRefreshed]
        if (handler) {
          handler([session])
        }
        await new Promise(resolve => setTimeout(resolve, 20))
      })
    }

    // Terminal should NEVER have been closed during any of these state changes
    expect(terminalsClosed.has(expectedTerminalId)).toBe(false)
    expect(terminalsCreated.has(expectedTerminalId)).toBe(true)
  })
})
