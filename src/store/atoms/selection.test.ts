import { describe, it, expect, beforeEach, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { createStore } from 'jotai'
import {
  selectionValueAtom,
  isReadyAtom,
  isSpecAtom,
  terminalsAtom,
  setSelectionActionAtom,
  clearTerminalTrackingActionAtom,
  getSessionSnapshotActionAtom,
  initializeSelectionEventsActionAtom,
  setProjectPathActionAtom,
  setSelectionFilterModeActionAtom,
  resetSelectionAtomsForTest,
  waitForSelectionAsyncEffectsForTest,
  getFilterModeForProjectForTest,
} from './selection'
import { projectPathAtom } from './project'
import { TauriCommands } from '../../common/tauriCommands'
import { FilterMode } from '../../types/sessionFilters'
import { stableSessionTerminalId } from '../../common/terminalIdentity'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

let eventListenCallCount = 0
const selectionEventHandlers: Array<(payload: { selection: { kind: 'session' | 'orchestrator'; payload?: string } }) => void> = []
const sessionsRefreshedHandlers: Array<(payload: unknown) => void> = []
const emitSessionsRefreshed = async (sessions: unknown[], projectPath = '/projects/alpha') => {
  await Promise.all(sessionsRefreshedHandlers.map(handler => handler({ projectPath, sessions })))
}
const sessionStateHandlers: Array<(payload: { sessionId: string }) => void> = []

vi.mock('../../common/eventSystem', () => ({
  listenEvent: vi.fn((event: string, handler: (payload: unknown) => void) => {
    eventListenCallCount += 1
    if (event === 'selection-event') {
      selectionEventHandlers.push(handler as typeof selectionEventHandlers[number])
    } else if (event === 'sessions-refreshed-event') {
      sessionsRefreshedHandlers.push(handler)
    }
    return Promise.resolve(() => {})
  }),
  SchaltEvent: {
    Selection: 'selection-event',
    SessionsRefreshed: 'sessions-refreshed-event',
  },
}))

vi.mock('../../common/uiEvents', () => ({
  UiEvent: {
    SelectionChanged: 'selection-changed',
    SessionStateChanged: 'session-state-changed',
    ProjectSwitchComplete: 'project-switch-complete',
  },
  emitUiEvent: vi.fn(),
  listenUiEvent: vi.fn((event: string, handler: (payload: unknown) => void) => {
    if (event === 'session-state-changed') {
      sessionStateHandlers.push(handler as typeof sessionStateHandlers[number])
    }
    return Promise.resolve(() => {})
  }),
  hasBackgroundStart: vi.fn(() => false),
  clearBackgroundStarts: vi.fn(),
}))

vi.mock('../../terminal/transport/backend', () => ({
  createTerminalBackend: vi.fn(() => Promise.resolve()),
  closeTerminalBackend: vi.fn(() => Promise.resolve()),
}))

vi.mock('../../terminal/registry/terminalRegistry', () => ({
  hasTerminalInstance: vi.fn(),
  acquireTerminalInstance: vi.fn(() => ({ record: { refCount: 1 }, isNew: true })),
  releaseTerminalInstance: vi.fn(),
  removeTerminalInstance: vi.fn(),
  releaseSessionTerminals: vi.fn(),
}))

vi.mock('../../components/terminal/Terminal', () => ({
  Terminal: () => null,
  clearTerminalStartedTracking: vi.fn(),
}))

function createRawSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'session-1',
    session_state: 'running',
    status: 'running',
    ready_to_merge: false,
    worktree_path: '/tmp/worktrees/session-1',
    branch: 'schaltwerk/session-1',
    ...overrides,
  }
}

async function withNodeEnv<T>(value: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = value
  try {
    return await fn()
  } finally {
    process.env.NODE_ENV = previous
  }
}

describe('selection atoms', () => {
  let store: ReturnType<typeof createStore>
  let core: typeof import('@tauri-apps/api/core')
  let nextSessionResponse: ReturnType<typeof createRawSession> | null
  let nextPathExistsResult: boolean | null

  beforeEach(async () => {
    store = createStore()
    resetSelectionAtomsForTest()
    selectionEventHandlers.length = 0
    sessionsRefreshedHandlers.length = 0
    sessionStateHandlers.length = 0
    nextSessionResponse = null
    nextPathExistsResult = null
    eventListenCallCount = 0

    core = await import('@tauri-apps/api/core')
    const invoke = vi.mocked(core.invoke)
    invoke.mockReset()
    invoke.mockImplementation(async (cmd, args?: unknown) => {
      if (cmd === TauriCommands.SchaltwerkCoreGetSession) {
        const typedArgs = args as Record<string, unknown> | undefined
        if (nextSessionResponse) {
          const response = nextSessionResponse
          nextSessionResponse = null
          return response
        }
        return createRawSession({ name: typedArgs?.name })
      }
      if (cmd === TauriCommands.PathExists) {
        if (typeof nextPathExistsResult === 'boolean') {
          const result = nextPathExistsResult
          nextPathExistsResult = null
          return result
        }
        return true
      }
      if (cmd === TauriCommands.DirectoryExists) {
        if (typeof nextPathExistsResult === 'boolean') {
          const result = nextPathExistsResult
          nextPathExistsResult = null
          return result
        }
        return true
      }
      throw new Error(`Unexpected command ${cmd}`)
    })

    const uiEvents = await import('../../common/uiEvents')
    vi.mocked(uiEvents.emitUiEvent).mockReset()
    vi.mocked(uiEvents.listenUiEvent).mockClear()

    const eventSystem = await import('../../common/eventSystem')
    vi.mocked(eventSystem.listenEvent).mockClear()

    const backend = await import('../../terminal/transport/backend')
    vi.mocked(backend.createTerminalBackend).mockClear()
    vi.mocked(backend.closeTerminalBackend).mockClear()

    const registry = await import('../../terminal/registry/terminalRegistry')
    vi.mocked(registry.hasTerminalInstance).mockReset()
    vi.mocked(registry.hasTerminalInstance).mockReturnValue(false)
    vi.mocked(registry.releaseSessionTerminals).mockReset()
    vi.mocked(registry.releaseTerminalInstance).mockReset()

    const terminal = await import('../../components/terminal/Terminal')
    vi.mocked(terminal.clearTerminalStartedTracking).mockClear()
  })

  const getInvokeCallCount = (command: string) =>
    vi.mocked(core.invoke).mock.calls.filter(([cmd]) => cmd === command).length

  const setProjectPath = (path: string | null) => store.set(setProjectPathActionAtom, path)

  it('exposes orchestrator as default selection and is ready', () => {
    expect(store.get(selectionValueAtom)).toEqual({ kind: 'orchestrator', projectPath: null })
    expect(store.get(isReadyAtom)).toBe(true)
    expect(store.get(isSpecAtom)).toBe(false)
  })

  it('clears terminal started tracking when clearing terminals', async () => {
    const terminal = await import('../../components/terminal/Terminal')
    const ids = ['term-1', 'term-2']
    await store.set(clearTerminalTrackingActionAtom, ids)
    expect(vi.mocked(terminal.clearTerminalStartedTracking)).toHaveBeenCalledWith(ids)
  })

  it('derives orchestrator terminal ids from project path', async () => {
    await store.set(setProjectPathActionAtom, '/Users/me/projects/my project')
    const terminals = store.get(terminalsAtom)
    expect(terminals.top).toMatch(/^orchestrator-my_project-[0-9a-f]{1,6}-top$/)
    expect(terminals.bottomBase).toMatch(/^orchestrator-my_project-[0-9a-f]{1,6}-bottom$/)
    expect(terminals.workingDirectory).toBe('/Users/me/projects/my project')
  })

  it('sets session selection with snapshot enrichment and terminal creation', async () => {
    await withNodeEnv('development', async () => {
      const backend = await import('../../terminal/transport/backend')
      await store.set(setProjectPathActionAtom, '/projects/alpha')
      vi.mocked(backend.createTerminalBackend).mockClear()
      await store.set(setSelectionActionAtom, { selection: { kind: 'session', payload: 'session-1' } })
      const selection = store.get(selectionValueAtom)
      expect(selection.kind).toBe('session')
      expect(selection.worktreePath).toBe('/tmp/worktrees/session-1')
      expect(store.get(isReadyAtom)).toBe(true)
      const terminals = store.get(terminalsAtom)
      expect(terminals.top).toMatch(/^session-session-1~[0-9a-f]{8}-top$/)
      expect(terminals.workingDirectory).toBe('/tmp/worktrees/session-1')
      expect(vi.mocked(backend.createTerminalBackend)).toHaveBeenCalledTimes(2)
    })
  })

  it('caches session snapshots to avoid duplicate fetches', async () => {
    await store.set(getSessionSnapshotActionAtom, { sessionId: 'session-1' })
    await store.set(getSessionSnapshotActionAtom, { sessionId: 'session-1' })
    expect(getInvokeCallCount(TauriCommands.SchaltwerkCoreGetSession)).toBe(1)
  })

  it('rebinds existing registry terminal instead of recreating when cache key changes', async () => {
    await withNodeEnv('development', async () => {
      const backend = await import('../../terminal/transport/backend')
      const registry = await import('../../terminal/registry/terminalRegistry')

      await setProjectPath('/projects/alpha')
      await store.set(setSelectionActionAtom, {
        selection: { kind: 'session', payload: 'session-1', worktreePath: '/tmp/worktrees/session-1', sessionState: 'running', projectPath: '/projects/alpha' },
      })

      // First creation creates top + bottom
      expect(vi.mocked(backend.createTerminalBackend).mock.calls.length).toBeGreaterThanOrEqual(2)

      vi.mocked(backend.createTerminalBackend).mockClear()
      vi.mocked(registry.hasTerminalInstance).mockReturnValue(true)

      await store.set(setSelectionActionAtom, {
        selection: { kind: 'session', payload: 'session-1', worktreePath: '/tmp/worktrees/session-1', sessionState: 'running', projectPath: '/projects/beta' },
        remember: false,
      })

      // Rebinding should skip backend creation when registry already has the id
      expect(vi.mocked(backend.createTerminalBackend)).not.toHaveBeenCalled()
      expect(vi.mocked(backend.closeTerminalBackend)).not.toHaveBeenCalled()
    })
  })

  it('verifies state with backend before resetting terminals when previous state is unknown but terminals exist', async () => {
    await withNodeEnv('development', async () => {
      const backend = await import('../../terminal/transport/backend')

      await setProjectPath('/projects/alpha')
      await store.set(initializeSelectionEventsActionAtom)

      // Manually create a terminal to simulate "tracking" without prior session state history
      // (e.g. via setSelectionActionAtom which doesn't update lastKnownSessionState)
      await store.set(setSelectionActionAtom, {
        selection: { kind: 'session', payload: 'session-1', sessionState: 'running', worktreePath: '/tmp/worktrees/session-1' },
      })
      
      // Verify terminal created
      expect(vi.mocked(backend.createTerminalBackend)).toHaveBeenCalled()
      vi.mocked(backend.closeTerminalBackend).mockClear()

      // Now receive a stale SPEC event
      // Backend verification should say "running"
      nextSessionResponse = createRawSession({ session_state: 'running', status: 'running', ready_to_merge: false })
      
      await emitSessionsRefreshed([
        { info: { session_id: 'session-1', session_state: 'spec', status: 'spec', ready_to_merge: false } },
      ])

      await waitFor(() => {
        // Verification should have prevented close
        expect(vi.mocked(backend.closeTerminalBackend)).not.toHaveBeenCalled()
      })
    })
  })

  it('verifies state with backend before resetting terminals on running->spec transition', async () => {
    await withNodeEnv('development', async () => {
      const backend = await import('../../terminal/transport/backend')

      await setProjectPath('/projects/alpha')
      await store.set(initializeSelectionEventsActionAtom)

      // Start in running state
      nextSessionResponse = createRawSession({ session_state: 'running', status: 'running', ready_to_merge: false })
      await emitSessionsRefreshed([
        { info: { session_id: 'session-1', session_state: 'running', status: 'running', ready_to_merge: false } },
      ])

      vi.mocked(backend.closeTerminalBackend).mockClear()

      // Simulate STALE spec event (e.g. from slow query)
      // BUT make sure the backend query returns RUNNING when verified
      nextSessionResponse = createRawSession({ session_state: 'running', status: 'running', ready_to_merge: false })
      
      await emitSessionsRefreshed([
        { info: { session_id: 'session-1', session_state: 'spec', status: 'spec', ready_to_merge: false } },
      ])

      await waitFor(() => {
        // Verification should have prevented close
        expect(vi.mocked(backend.closeTerminalBackend)).not.toHaveBeenCalled()
      })

      // Now simulate ACTUAL spec transition (backend returns spec)
      nextSessionResponse = createRawSession({ session_state: 'spec', status: 'spec', ready_to_merge: false })
      
      await emitSessionsRefreshed([
        { info: { session_id: 'session-1', session_state: 'spec', status: 'spec', ready_to_merge: false } },
      ])

      await waitFor(() => {
        expect(vi.mocked(backend.closeTerminalBackend)).toHaveBeenCalled()
      })
    })
  })

  it('exposes orchestrator selection when project path changes before selection updates', async () => {
    await store.set(setProjectPathActionAtom, '/projects/alpha')
    await store.set(setSelectionActionAtom, { selection: { kind: 'session', payload: 'session-1' } })

    // Simulate project switch propagation before selection atoms finish updating
    store.set(projectPathAtom, '/projects/beta')

    const selection = store.get(selectionValueAtom)
    expect(selection).toEqual({ kind: 'orchestrator', projectPath: '/projects/beta' })
  })

  it('namespaces session snapshots per project path', async () => {
    await store.set(setProjectPathActionAtom, '/projects/alpha')
    await store.set(getSessionSnapshotActionAtom, { sessionId: 'session-1' })

    await store.set(setProjectPathActionAtom, '/projects/beta')
    await store.set(getSessionSnapshotActionAtom, { sessionId: 'session-1' })

    await store.set(setProjectPathActionAtom, '/projects/alpha')
    await store.set(getSessionSnapshotActionAtom, { sessionId: 'session-1' })

    expect(getInvokeCallCount(TauriCommands.SchaltwerkCoreGetSession)).toBe(2)
  })

  it('refresh option bypasses snapshot cache', async () => {
    await store.set(getSessionSnapshotActionAtom, { sessionId: 'session-1' })
    vi.mocked(core.invoke).mockResolvedValueOnce(createRawSession({ ready_to_merge: true }))
    const snapshot = await store.set(getSessionSnapshotActionAtom, { sessionId: 'session-1', refresh: true })
    expect(snapshot?.readyToMerge).toBe(true)
    expect(getInvokeCallCount(TauriCommands.SchaltwerkCoreGetSession)).toBe(2)
  })

  it('deduplicates concurrent snapshot fetches', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    const pending = new Promise(resolve => {
      resolveFetch = resolve
    })
    vi.mocked(core.invoke).mockImplementation(() => pending as Promise<unknown>)

    const first = store.set(getSessionSnapshotActionAtom, { sessionId: 'session-2' })
    const second = store.set(getSessionSnapshotActionAtom, { sessionId: 'session-2' })
    resolveFetch(createRawSession({ name: 'session-2' }))
    await Promise.all([first, second])
    expect(getInvokeCallCount(TauriCommands.SchaltwerkCoreGetSession)).toBe(1)
  })

  it('reuses cached snapshot inside setSelectionActionAtom', async () => {
    await store.set(getSessionSnapshotActionAtom, { sessionId: 'session-1' })
    vi.mocked(core.invoke).mockClear()
    await store.set(setSelectionActionAtom, { selection: { kind: 'session', payload: 'session-1' } })
    expect(getInvokeCallCount(TauriCommands.SchaltwerkCoreGetSession)).toBe(0)
  })

  it('emits ui event only for intentional selections', async () => {
    const uiEvents = await import('../../common/uiEvents')
    await store.set(setSelectionActionAtom, { selection: { kind: 'session', payload: 'session-1' }, isIntentional: true })
    const selectionEvents = vi.mocked(uiEvents.emitUiEvent).mock.calls.filter(
      ([event]) => event === uiEvents.UiEvent.SelectionChanged,
    )
    expect(selectionEvents).toHaveLength(1)
    expect(selectionEvents[0]?.[1]).toEqual(expect.any(Object))

    vi.mocked(uiEvents.emitUiEvent).mockClear()
    await store.set(setSelectionActionAtom, { selection: { kind: 'session', payload: 'session-1' }, isIntentional: false })
    const unintentionalCalls = vi.mocked(uiEvents.emitUiEvent).mock.calls.filter(
      ([event]) => event === uiEvents.UiEvent.SelectionChanged,
    )
    expect(unintentionalCalls).toHaveLength(0)
  })

  it('avoids recreating terminals unless forced', async () => {
    await withNodeEnv('development', async () => {
      const backend = await import('../../terminal/transport/backend')
      await store.set(setSelectionActionAtom, { selection: { kind: 'session', payload: 'session-1' } })
      vi.mocked(backend.createTerminalBackend).mockClear()
      await store.set(setSelectionActionAtom, { selection: { kind: 'session', payload: 'session-1' } })
      expect(vi.mocked(backend.createTerminalBackend)).not.toHaveBeenCalled()

      await store.set(setSelectionActionAtom, { selection: { kind: 'session', payload: 'session-1' }, forceRecreate: true })
      expect(vi.mocked(backend.createTerminalBackend)).toHaveBeenCalled()
    })
  })

  it('clears terminal tracking and closes terminals', async () => {
    await withNodeEnv('development', async () => {
      const backend = await import('../../terminal/transport/backend')
      await store.set(setSelectionActionAtom, { selection: { kind: 'session', payload: 'session-1' } })
      const terminals = store.get(terminalsAtom)
      await store.set(clearTerminalTrackingActionAtom, [terminals.top, terminals.bottomBase])
      expect(vi.mocked(backend.closeTerminalBackend)).toHaveBeenCalledTimes(2)

      vi.mocked(backend.createTerminalBackend).mockClear()
      await store.set(setSelectionActionAtom, { selection: { kind: 'session', payload: 'session-1' }, forceRecreate: true })
      expect(vi.mocked(backend.createTerminalBackend)).toHaveBeenCalledTimes(2)
    })
  })

  it('initializes events only once and responds to selection event', async () => {
    eventListenCallCount = 0
    await store.set(initializeSelectionEventsActionAtom)
    await store.set(initializeSelectionEventsActionAtom)
    expect(eventListenCallCount).toBe(2)

    const uiEvents = await import('../../common/uiEvents')
    vi.mocked(uiEvents.emitUiEvent).mockClear()
    selectionEventHandlers[0]?.({ selection: { kind: 'orchestrator' } })
    const selectionCalls = vi.mocked(uiEvents.emitUiEvent).mock.calls.filter(
      ([event]) => event === uiEvents.UiEvent.SelectionChanged,
    )
    expect(selectionCalls).toHaveLength(0)
  })

  it('refreshes snapshot when session state change event matches current selection', async () => {
    await store.set(setProjectPathActionAtom, '/projects/alpha')
    await store.set(setSelectionActionAtom, { selection: { kind: 'session', payload: 'session-1' } })
    vi.mocked(core.invoke).mockResolvedValueOnce(createRawSession({ session_state: 'reviewed' }))

    await store.set(initializeSelectionEventsActionAtom)
    sessionStateHandlers[0]?.({ sessionId: 'session-1' })
    await waitForSelectionAsyncEffectsForTest()
    const selection = store.get(selectionValueAtom)
    expect(selection.sessionState).toBe('reviewed')
    expect(getInvokeCallCount(TauriCommands.SchaltwerkCoreGetSession)).toBe(2)
  })

  it('updates selection when sessions refreshed with matching session', async () => {
    await store.set(setProjectPathActionAtom, '/projects/alpha')
    nextSessionResponse = createRawSession({ session_state: 'running', worktree_path: '/tmp/worktrees/session-1' })
    await store.set(setSelectionActionAtom, {
      selection: { kind: 'session', payload: 'session-1', sessionState: 'spec' },
    })
    await store.set(initializeSelectionEventsActionAtom)

    await emitSessionsRefreshed([
      { info: { session_id: 'session-1' } },
      { info: { session_id: 'other-session' } },
    ])
    await waitForSelectionAsyncEffectsForTest()

    const selection = store.get(selectionValueAtom)
    expect(selection.sessionState).toBe('running')
    expect(selection.worktreePath).toBe('/tmp/worktrees/session-1')
    expect(getInvokeCallCount(TauriCommands.SchaltwerkCoreGetSession)).toBeGreaterThanOrEqual(1)
  })

  it('ignores backend spec selection when running filter active', async () => {
    await store.set(setProjectPathActionAtom, '/projects/alpha')
    await store.set(setSelectionFilterModeActionAtom, FilterMode.Running)
    await store.set(setSelectionActionAtom, {
      selection: { kind: 'session', payload: 'running-session', sessionState: 'running', worktreePath: '/tmp/run' },
    })
    await store.set(initializeSelectionEventsActionAtom)

    nextSessionResponse = createRawSession({ name: 'spec-session', session_state: 'spec', worktree_path: null })
    selectionEventHandlers[0]?.({ selection: { kind: 'session', payload: 'spec-session' } })
    await waitForSelectionAsyncEffectsForTest()

    const selection = store.get(selectionValueAtom)
    expect(selection.payload).toBe('running-session')
    expect(selection.sessionState).toBe('running')
  })

  it('reuses orchestrator terminals when revisiting a project', async () => {
    await withNodeEnv('development', async () => {
      const backend = await import('../../terminal/transport/backend')
      const uiEvents = await import('../../common/uiEvents')

      await store.set(setProjectPathActionAtom, '/projects/alpha')
      vi.mocked(backend.createTerminalBackend).mockClear()
      vi.mocked(uiEvents.emitUiEvent).mockClear()

      await store.set(setProjectPathActionAtom, '/projects/beta')
      expect(vi.mocked(backend.createTerminalBackend)).toHaveBeenCalledTimes(2)
      const betaCalls = vi.mocked(backend.createTerminalBackend).mock.calls
      expect(betaCalls[0]?.[0]?.id ?? '').toContain('orchestrator')
      expect(betaCalls[0]?.[0]?.cwd).toBe('/projects/beta')

      const betaSwitchCalls = vi.mocked(uiEvents.emitUiEvent).mock.calls.filter(
        ([event]) => event === uiEvents.UiEvent.ProjectSwitchComplete,
      )
      expect(betaSwitchCalls).toHaveLength(1)
    expect(betaSwitchCalls[0]?.[1]).toEqual({ projectPath: '/projects/beta' })

    vi.mocked(backend.createTerminalBackend).mockClear()
    vi.mocked(uiEvents.emitUiEvent).mockClear()

    await store.set(setProjectPathActionAtom, '/projects/alpha')
    expect(vi.mocked(backend.createTerminalBackend)).not.toHaveBeenCalled()
      const alphaSwitchCalls = vi.mocked(uiEvents.emitUiEvent).mock.calls.filter(
        ([event]) => event === uiEvents.UiEvent.ProjectSwitchComplete,
      )
      expect(alphaSwitchCalls).toHaveLength(1)
      expect(alphaSwitchCalls[0]?.[1]).toEqual({ projectPath: '/projects/alpha' })
    })
  })

  it('does not recreate session terminals when project path changes and session is reselected', async () => {
    await withNodeEnv('development', async () => {
      const backend = await import('../../terminal/transport/backend')

      await store.set(setProjectPathActionAtom, '/projects/alpha')
      await store.set(setSelectionActionAtom, {
        selection: { kind: 'session', payload: 'session-1', sessionState: 'running', worktreePath: '/tmp/worktrees/session-1' },
      })

      expect(vi.mocked(backend.createTerminalBackend).mock.calls.length).toBeGreaterThanOrEqual(2)

      vi.mocked(backend.createTerminalBackend).mockClear()

      // Switch to another project (selection will fall back to orchestrator)
      await store.set(setProjectPathActionAtom, '/projects/beta')

      // Reselect same session (simulating user switching back or remembered selection)
      await store.set(setSelectionActionAtom, {
        selection: { kind: 'session', payload: 'session-1', sessionState: 'running', worktreePath: '/tmp/worktrees/session-1', projectPath: '/projects/beta' },
      })

      // Should not recreate session terminals; orchestrator boot is allowed
      const sessionCalls = vi.mocked(backend.createTerminalBackend).mock.calls.filter(
        ([args]) => (args?.id ?? '').includes('session-')
      )
      expect(sessionCalls).toHaveLength(0)
    })
  })

  it('skips orchestrator terminals when project path is cleared', async () => {
    await withNodeEnv('development', async () => {
      const backend = await import('../../terminal/transport/backend')

      await store.set(setProjectPathActionAtom, '/projects/alpha')
      vi.mocked(backend.createTerminalBackend).mockClear()

      await store.set(setProjectPathActionAtom, null)

      expect(vi.mocked(backend.createTerminalBackend)).not.toHaveBeenCalled()
    })
  })

  it('skips orchestrator terminals when project directory is missing', async () => {
    await withNodeEnv('development', async () => {
      const backend = await import('../../terminal/transport/backend')

      await store.set(setProjectPathActionAtom, '/projects/alpha')
      vi.mocked(backend.createTerminalBackend).mockClear()

      nextPathExistsResult = false
      await store.set(setProjectPathActionAtom, '/projects/missing')

      expect(vi.mocked(backend.createTerminalBackend)).not.toHaveBeenCalled()
    })
  })

  it('skips terminal creation for spec sessions', async () => {
    const backend = await import('../../terminal/transport/backend')
    vi.mocked(backend.createTerminalBackend).mockClear()
    nextSessionResponse = createRawSession({ session_state: 'spec', worktree_path: undefined })

    await store.set(setSelectionActionAtom, { selection: { kind: 'session', payload: 'session-1' } })

    expect(vi.mocked(backend.createTerminalBackend)).not.toHaveBeenCalled()
    expect(getInvokeCallCount(TauriCommands.PathExists)).toBe(0)
  })

  it('skips terminal creation when worktree path is missing', async () => {
    const backend = await import('../../terminal/transport/backend')
    vi.mocked(backend.createTerminalBackend).mockClear()
    nextPathExistsResult = false

    await store.set(setSelectionActionAtom, { selection: { kind: 'session', payload: 'session-1' } })

    expect(vi.mocked(backend.createTerminalBackend)).not.toHaveBeenCalled()
    expect(getInvokeCallCount(TauriCommands.PathExists)).toBe(1)
  })

  it('remembers selection per project and restores when switching back', async () => {
    await store.set(setProjectPathActionAtom, '/projects/alpha')
    await store.set(setSelectionActionAtom, {
      selection: {
        kind: 'session',
        payload: 'alpha-session',
        sessionState: 'running',
        worktreePath: '/tmp/worktrees/alpha-session',
      },
      isIntentional: true,
    })

    await store.set(setProjectPathActionAtom, '/projects/beta')
    expect(store.get(selectionValueAtom)).toEqual({ kind: 'orchestrator', projectPath: '/projects/beta' })

    await store.set(setSelectionActionAtom, {
      selection: {
        kind: 'session',
        payload: 'beta-session',
        sessionState: 'running',
        worktreePath: '/tmp/worktrees/beta-session',
      },
      isIntentional: true,
    })

    await store.set(setProjectPathActionAtom, '/projects/alpha')
    const restoredSelection = store.get(selectionValueAtom)
    expect(restoredSelection.kind).toBe('session')
    expect(restoredSelection.payload).toBe('alpha-session')
  })

  it('restores selection and filter per project without recreating terminals', async () => {
    await withNodeEnv('development', async () => {
      const backend = await import('../../terminal/transport/backend')

      await store.set(setProjectPathActionAtom, '/projects/alpha')
      await store.set(setSelectionFilterModeActionAtom, FilterMode.Running)
      await store.set(setSelectionActionAtom, {
        selection: {
          kind: 'session',
          payload: 'alpha-session',
          sessionState: 'running',
          worktreePath: '/tmp/worktrees/alpha-session',
        },
        isIntentional: true,
      })

      await store.set(setProjectPathActionAtom, '/projects/beta')
      await store.set(setSelectionFilterModeActionAtom, FilterMode.Spec)
      await store.set(setSelectionActionAtom, {
        selection: {
          kind: 'session',
          payload: 'beta-session',
          sessionState: 'running',
          worktreePath: '/tmp/worktrees/beta-session',
        },
        isIntentional: true,
      })

      vi.mocked(backend.createTerminalBackend).mockClear()

      await store.set(setProjectPathActionAtom, '/projects/alpha')

      const restoredSelection = store.get(selectionValueAtom)
      expect(restoredSelection.payload).toBe('alpha-session')
      expect(getFilterModeForProjectForTest('/projects/alpha')).toBe(FilterMode.Running)
      expect(getFilterModeForProjectForTest('/projects/beta')).toBe(FilterMode.Spec)
      expect(vi.mocked(backend.createTerminalBackend)).not.toHaveBeenCalled()
    })
  })

  it('skips remembering selection when remember flag is false', async () => {
    await store.set(setProjectPathActionAtom, '/projects/alpha')

    await store.set(setSelectionActionAtom, {
      selection: {
        kind: 'session',
        payload: 'initial-session',
        sessionState: 'running',
        worktreePath: '/tmp/worktrees/initial-session',
      },
      isIntentional: true,
    })

    await store.set(setSelectionActionAtom, {
      selection: {
        kind: 'session',
        payload: 'transient-session',
        sessionState: 'running',
        worktreePath: '/tmp/worktrees/transient-session',
      },
      remember: false,
    })

    await store.set(setProjectPathActionAtom, '/projects/beta')
    await store.set(setProjectPathActionAtom, '/projects/alpha')

    const restoredSelection = store.get(selectionValueAtom)
    expect(restoredSelection.payload).toBe('initial-session')
  })

  it('clears session terminals when SessionsRefreshed converts to spec', async () => {
    const backend = await import('../../terminal/transport/backend')
    const closeMock = vi.mocked(backend.closeTerminalBackend)
    closeMock.mockClear()

    await store.set(setSelectionActionAtom, {
      selection: {
        kind: 'session',
        payload: 'session-1',
      },
    })

    await store.set(initializeSelectionEventsActionAtom)
    await waitForSelectionAsyncEffectsForTest()

    nextSessionResponse = createRawSession({
      session_state: 'spec',
      status: 'spec',
      ready_to_merge: false,
    })

    const payload = [
      {
        info: {
          session_id: 'session-1',
          session_state: 'spec',
          status: 'spec',
          ready_to_merge: false,
        },
      },
    ]

    expect(sessionsRefreshedHandlers.length).toBeGreaterThan(0)
    await emitSessionsRefreshed(payload)
    await waitForSelectionAsyncEffectsForTest()

    const topId = stableSessionTerminalId('session-1', 'top')
    const bottomId = stableSessionTerminalId('session-1', 'bottom')

    await waitFor(() => {
      expect(closeMock).toHaveBeenCalledWith(topId)
    })
    await waitFor(() => {
      expect(closeMock).toHaveBeenCalledWith(bottomId)
    })
  })

  it('clears session terminals when SessionStateChanged converts to spec', async () => {
    const backend = await import('../../terminal/transport/backend')
    const closeMock = vi.mocked(backend.closeTerminalBackend)
    closeMock.mockClear()

    await store.set(setSelectionActionAtom, {
      selection: {
        kind: 'session',
        payload: 'session-1',
      },
    })

    await store.set(initializeSelectionEventsActionAtom)
    await waitForSelectionAsyncEffectsForTest()

    nextSessionResponse = createRawSession({
      session_state: 'spec',
      status: 'spec',
      ready_to_merge: false,
    })

    expect(sessionStateHandlers.length).toBeGreaterThan(0)
    sessionStateHandlers[0]({ sessionId: 'session-1' })
    await waitForSelectionAsyncEffectsForTest()

    const topId = stableSessionTerminalId('session-1', 'top')
    const bottomId = stableSessionTerminalId('session-1', 'bottom')

    await waitFor(() => {
      expect(closeMock).toHaveBeenCalledWith(topId)
    })
    await waitFor(() => {
      expect(closeMock).toHaveBeenCalledWith(bottomId)
    })
  })
})
