import { atom } from 'jotai'
import type { WritableAtom } from 'jotai'
type SetAtomFunction = <Value, Result>(
  atom: WritableAtom<unknown, [Value], Result>,
  value: Value,
) => Result
import { invoke } from '@tauri-apps/api/core'
import { sessionTerminalGroup } from '../../common/terminalIdentity'
import { TauriCommands } from '../../common/tauriCommands'
import { emitUiEvent, listenUiEvent, UiEvent } from '../../common/uiEvents'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { createTerminalBackend, closeTerminalBackend } from '../../terminal/transport/backend'
import { logger } from '../../utils/logger'
import type { RawSession } from '../../types/session'
import { FilterMode } from '../../types/sessionFilters'

export interface Selection {
  kind: 'session' | 'orchestrator'
  payload?: string
  worktreePath?: string
  sessionState?: 'spec' | 'running' | 'reviewed'
}

interface TerminalSet {
  top: string
  bottomBase: string
  workingDirectory: string
}

type NormalizedSessionState = NonNullable<Selection['sessionState']>

interface SessionSnapshot {
  sessionId: string
  sessionState: NormalizedSessionState
  worktreePath?: string
  branch?: string
  readyToMerge?: boolean
}

interface SetSelectionPayload {
  selection: Selection
  forceRecreate?: boolean
  isIntentional?: boolean
  remember?: boolean
  rememberProjectPath?: string | null
}

interface SnapshotRequest {
  sessionId: string
  refresh?: boolean
}

const selectionAtom = atom<Selection>({ kind: 'orchestrator' })
const projectPathAtom = atom<string | null>(null)
let currentFilterMode: FilterMode = FilterMode.All

export const selectionValueAtom = atom(get => get(selectionAtom))

export const isSpecAtom = atom(get => {
  const selection = get(selectionAtom)
  return selection.kind === 'session' && selection.sessionState === 'spec'
})

export const isReadyAtom = atom(get => {
  const selection = get(selectionAtom)
  if (selection.kind === 'orchestrator') return true
  if (selection.sessionState === 'spec') return true
  return Boolean(selection.worktreePath)
})

let cachedProjectPath: string | null = null
let cachedProjectId = 'default'

function getCachedProjectId(path: string | null): string {
  if (path === cachedProjectPath) {
    return cachedProjectId
  }

  cachedProjectPath = path
  if (!path) {
    cachedProjectId = 'default'
    return cachedProjectId
  }

  const dirName = path.split(/[/\\]/).pop() || 'unknown'
  const sanitizedDirName = dirName.replace(/[^a-zA-Z0-9_-]/g, '_')
  let hash = 0
  for (let i = 0; i < path.length; i += 1) {
    hash = ((hash << 5) - hash) + path.charCodeAt(i)
    hash &= hash
  }
  cachedProjectId = `${sanitizedDirName}-${Math.abs(hash).toString(16).slice(0, 6) || '0'}`
  return cachedProjectId
}

function computeTerminals(selection: Selection, projectPath: string | null): TerminalSet {
  if (selection.kind === 'orchestrator') {
    const projectId = getCachedProjectId(projectPath)
    const base = `orchestrator-${projectId}`
    return {
      top: `${base}-top`,
      bottomBase: `${base}-bottom`,
      workingDirectory: projectPath ?? '',
    }
  }

  const group = sessionTerminalGroup(selection.payload)
  const workingDirectory = selection.sessionState === 'running' && selection.worktreePath
    ? selection.worktreePath
    : ''

  return {
    top: group.top,
    bottomBase: group.bottomBase,
    workingDirectory: workingDirectory ?? '',
  }
}

function selectionEquals(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) {
    return false
  }
  if (a.kind === 'orchestrator') {
    return true
  }
  if (b.kind !== 'session') {
    return false
  }
  return (
    (a.payload ?? null) === (b.payload ?? null) &&
    (a.sessionState ?? null) === (b.sessionState ?? null) &&
    (a.worktreePath ?? null) === (b.worktreePath ?? null)
  )
}

function rememberSelectionForProject(projectPath: string, selection: Selection): void {
  lastSelectionByProject.set(projectPath, { ...selection })
}

function selectionMatchesCurrentFilter(selection: Selection): boolean {
  if (selection.kind === 'orchestrator') {
    return true
  }

  const state = selection.sessionState ?? null
  switch (currentFilterMode) {
    case FilterMode.Spec:
      return state === 'spec'
    case FilterMode.Running:
      return state === 'running'
    case FilterMode.Reviewed:
      return state === 'reviewed'
    case FilterMode.All:
    default:
      return true
  }
}

export const terminalsAtom = atom<TerminalSet>(get => computeTerminals(get(selectionAtom), get(projectPathAtom)))

export const setSelectionFilterModeActionAtom = atom(
  null,
  (_get, _set, mode: FilterMode) => {
    currentFilterMode = mode
  },
)

function normalizeSessionState(state?: string | null, status?: string, readyToMerge?: boolean): NormalizedSessionState {
  if (state === 'spec' || state === 'running' || state === 'reviewed') {
    return state
  }
  if (status === 'spec') {
    return 'spec'
  }
  if (readyToMerge) {
    return 'reviewed'
  }
  return 'running'
}

function snapshotFromRawSession(raw: RawSession): SessionSnapshot {
  return {
    sessionId: raw.name,
    sessionState: normalizeSessionState(raw.session_state, raw.status, raw.ready_to_merge),
    worktreePath: raw.worktree_path ?? undefined,
    branch: raw.branch ?? undefined,
    readyToMerge: raw.ready_to_merge ?? undefined,
  }
}

const sessionSnapshotsCache = new Map<string, SessionSnapshot>()
const sessionFetchPromises = new Map<string, Promise<SessionSnapshot | null>>()
const terminalsCache = new Map<string, Set<string>>()
const terminalToSelectionKey = new Map<string, string>()
const selectionsNeedingRecreate = new Set<string>()
const lastKnownSessionState = new Map<string, NormalizedSessionState>()
const lastSelectionByProject = new Map<string, Selection>()
let pendingAsyncEffect: Promise<void> | null = null

let eventCleanup: (() => void) | null = null

export const getSessionSnapshotActionAtom = atom(
  null,
  async (_get, _set, request: SnapshotRequest): Promise<SessionSnapshot | null> => {
    const { sessionId, refresh } = request
    if (!sessionId) return null

    if (!refresh) {
      const cached = sessionSnapshotsCache.get(sessionId)
      if (cached) return cached
    } else {
      sessionSnapshotsCache.delete(sessionId)
      sessionFetchPromises.delete(sessionId)
    }

    const existing = sessionFetchPromises.get(sessionId)
    if (existing && !refresh) {
      return existing
    }

    const fetchPromise = (async () => {
      try {
        const raw = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: sessionId })
        if (!raw) {
          return null
        }
        const snapshot = snapshotFromRawSession(raw)
        sessionSnapshotsCache.set(sessionId, snapshot)
        return snapshot
      } catch (error) {
        logger.warn('[selection] Failed to fetch session snapshot', error)
        return null
      } finally {
        sessionFetchPromises.delete(sessionId)
      }
    })()

    sessionFetchPromises.set(sessionId, fetchPromise)
    return fetchPromise
  },
)

function selectionCacheKey(selection: Selection): string {
  if (selection.kind === 'orchestrator') {
    return 'orchestrator'
  }
  return `session:${selection.payload ?? 'unknown'}`
}


async function ensureTerminal(
  id: string,
  cwd: string,
  tracked: Set<string>,
  force: boolean,
  cacheKey: string,
): Promise<void> {
  const isTestEnv = typeof process !== 'undefined' && process.env.NODE_ENV === 'test'

  if (!force && tracked.has(id)) {
    return
  }

  if (force && tracked.has(id)) {
    try {
      await closeTerminalBackend(id)
    } catch (error) {
      logger.warn('[selection] Failed to close terminal during recreation', { id, error })
    }
    tracked.delete(id)
    terminalToSelectionKey.delete(id)
  }

  if (isTestEnv) {
    tracked.add(id)
    terminalToSelectionKey.set(id, cacheKey)
    return
  }

  await createTerminalBackend({ id, cwd })
  tracked.add(id)
  terminalToSelectionKey.set(id, cacheKey)
}

export const setSelectionActionAtom = atom(
  null,
  async (get, set, payload: SetSelectionPayload): Promise<void> => {
    const {
      selection,
      forceRecreate = false,
      isIntentional = true,
      remember,
      rememberProjectPath,
    } = payload
    const current = get(selectionAtom)
    let resolvedSelection: Selection = selection
    const projectPath = get(projectPathAtom)
    const rememberTargetProject = (rememberProjectPath ?? projectPath) ?? undefined
    const shouldRemember = (remember ?? true) && Boolean(rememberTargetProject)
    let rememberApplied = false
    const rememberSelectionIfNeeded = () => {
      if (!shouldRemember || rememberApplied || !rememberTargetProject) {
        return
      }
      rememberApplied = true
      rememberSelectionForProject(rememberTargetProject, resolvedSelection)
    }

    if (selection.kind === 'session' && selection.payload) {
      const needsSnapshot = !selection.worktreePath || !selection.sessionState
      if (needsSnapshot) {
        const snapshot = await set(getSessionSnapshotActionAtom, { sessionId: selection.payload })
        if (snapshot) {
          resolvedSelection = {
            ...selection,
            worktreePath: snapshot.worktreePath,
            sessionState: snapshot.sessionState,
          }
        }
      }
    }

    const terminals = computeTerminals(resolvedSelection, projectPath)
    const cacheKey = selectionCacheKey(resolvedSelection)
    const pendingRecreate = selectionsNeedingRecreate.has(cacheKey)
    const effectiveForceRecreate = forceRecreate || pendingRecreate
    let tracked = terminalsCache.get(cacheKey)
    if (!tracked) {
      tracked = new Set<string>()
      terminalsCache.set(cacheKey, tracked)
    }
    const missingTop = !tracked.has(terminals.top)
    const missingBottom = !tracked.has(terminals.bottomBase)

    const unchanged = !forceRecreate && selectionEquals(current, resolvedSelection)

    if (!unchanged) {
      set(selectionAtom, resolvedSelection)
    }

    if (effectiveForceRecreate || missingTop || missingBottom) {
      let shouldCreateTerminals = true

      if (resolvedSelection.kind === 'session') {
        if (resolvedSelection.sessionState === 'spec') {
          shouldCreateTerminals = false
        } else {
          const cwd = terminals.workingDirectory
          if (!cwd) {
            logger.warn('[selection] Skipping terminal creation for session without worktree', {
              sessionId: resolvedSelection.payload,
            })
            shouldCreateTerminals = false
          } else {
            try {
              const worktreeExists = await invoke<boolean>(TauriCommands.PathExists, { path: cwd })
              if (!worktreeExists) {
                logger.warn('[selection] Worktree path does not exist; skipping terminal creation', {
                  sessionId: resolvedSelection.payload,
                  worktreePath: cwd,
                })
                shouldCreateTerminals = false
              } else {
                const gitDirExists = await invoke<boolean>(TauriCommands.PathExists, { path: `${cwd}/.git` })
                if (!gitDirExists) {
                  logger.warn('[selection] Worktree missing git metadata; skipping terminal creation', {
                    sessionId: resolvedSelection.payload,
                    worktreePath: cwd,
                  })
                  shouldCreateTerminals = false
                }
              }
            } catch (error) {
              logger.warn('[selection] Failed to validate session worktree before creating terminals', {
                sessionId: resolvedSelection.payload,
                error,
              })
              shouldCreateTerminals = false
            }
          }
        }
      }

      if (shouldCreateTerminals) {
        await Promise.all([
          ensureTerminal(terminals.top, terminals.workingDirectory, tracked, effectiveForceRecreate, cacheKey),
          ensureTerminal(terminals.bottomBase, terminals.workingDirectory, tracked, effectiveForceRecreate, cacheKey),
        ])
      }
    }

    if (pendingRecreate) {
      selectionsNeedingRecreate.delete(cacheKey)
    }

    if (unchanged && !effectiveForceRecreate && !missingTop && !missingBottom) {
      rememberSelectionIfNeeded()
      if (isIntentional) {
        emitUiEvent(UiEvent.SelectionChanged, resolvedSelection)
      }
      return
    }

    rememberSelectionIfNeeded()
    if (isIntentional) {
      emitUiEvent(UiEvent.SelectionChanged, resolvedSelection)
    }
  },
)

export const clearTerminalTrackingActionAtom = atom(
  null,
  async (_get, _set, terminalIds: string[]): Promise<void> => {
    for (const id of terminalIds) {
      try {
        await closeTerminalBackend(id)
      } catch (error) {
        logger.warn('[selection] Failed to close terminal during cleanup', { id, error })
      }
      const key = terminalToSelectionKey.get(id)
      if (!key) {
        continue
      }
      selectionsNeedingRecreate.add(key)
      terminalToSelectionKey.delete(id)
      const tracked = terminalsCache.get(key)
      if (!tracked) {
        continue
      }
      tracked.delete(id)
      if (tracked.size === 0) {
        terminalsCache.delete(key)
      }
    }
  },
)

async function handleSessionStateUpdate(
  set: SetAtomFunction,
  sessionId: string,
  nextState: NormalizedSessionState,
): Promise<void> {
  const previous = lastKnownSessionState.get(sessionId)
  lastKnownSessionState.set(sessionId, nextState)

  if (nextState === 'spec' && previous !== 'spec') {
    const group = sessionTerminalGroup(sessionId)
    await set(clearTerminalTrackingActionAtom, [group.top, group.bottomBase])
    const cacheKey = selectionCacheKey({ kind: 'session', payload: sessionId })
    selectionsNeedingRecreate.add(cacheKey)
  }
}

export const setProjectPathActionAtom = atom(
  null,
  async (get, set, path: string | null) => {
    const previous = get(projectPathAtom)
    if (previous === path) {
      return
    }
    const orchestratorKey = selectionCacheKey({ kind: 'orchestrator' })
    const tracked = terminalsCache.get(orchestratorKey)
    if (tracked && tracked.size > 0) {
      await set(clearTerminalTrackingActionAtom, Array.from(tracked))
    }

    set(projectPathAtom, path)

    const resolveRememberedSelectionForProject = async (project: string): Promise<{ selection: Selection; hadRemembered: boolean }> => {
      const remembered = lastSelectionByProject.get(project)
      if (!remembered) {
        return { selection: { kind: 'orchestrator' }, hadRemembered: false }
      }

      if (remembered.kind === 'session' && remembered.payload) {
        const snapshot = await set(getSessionSnapshotActionAtom, { sessionId: remembered.payload })
        if (!snapshot) {
          lastSelectionByProject.delete(project)
          return { selection: { kind: 'orchestrator' }, hadRemembered: true }
        }

        const sessionState = snapshot.sessionState ?? remembered.sessionState ?? 'running'
        const worktreePath = snapshot.worktreePath ?? remembered.worktreePath

        if (sessionState !== 'spec') {
          if (!worktreePath) {
            lastSelectionByProject.delete(project)
            return { selection: { kind: 'orchestrator' }, hadRemembered: true }
          }
          try {
            const exists = await invoke<boolean>(TauriCommands.DirectoryExists, { path: worktreePath })
            if (!exists) {
              lastSelectionByProject.delete(project)
              return { selection: { kind: 'orchestrator' }, hadRemembered: true }
            }
          } catch (error) {
            logger.warn('[selection] Failed to validate remembered worktree during project switch', {
              projectPath: project,
              sessionId: remembered.payload,
              error,
            })
            lastSelectionByProject.delete(project)
            return { selection: { kind: 'orchestrator' }, hadRemembered: true }
          }
        }

        const sanitized: Selection = {
          kind: 'session',
          payload: remembered.payload,
          sessionState,
          worktreePath,
        }
        rememberSelectionForProject(project, sanitized)
        return { selection: sanitized, hadRemembered: true }
      }

      rememberSelectionForProject(project, { kind: 'orchestrator' })
      return { selection: { kind: 'orchestrator' }, hadRemembered: true }
    }

    let nextSelection: Selection = { kind: 'orchestrator' }
    let remembered: Selection | null = null
    if (path) {
      const resolved = await resolveRememberedSelectionForProject(path)
      nextSelection = resolved.selection
      remembered = resolved.hadRemembered ? resolved.selection : null
    }

    const matchesFilter = selectionMatchesCurrentFilter(nextSelection)
    if (!matchesFilter) {
      nextSelection = { kind: 'orchestrator' }
    }

    if (path && matchesFilter) {
      rememberSelectionForProject(path, nextSelection)
    } else if (path && !matchesFilter && !remembered) {
      rememberSelectionForProject(path, nextSelection)
    }

    await set(setSelectionActionAtom, {
      selection: nextSelection,
      forceRecreate: true,
      isIntentional: false,
      remember: false,
    })

    const hadPreviousProject = previous !== null && previous !== undefined
    if (previous !== path && hadPreviousProject) {
      emitUiEvent(UiEvent.ProjectSwitchComplete, { projectPath: path ?? '' })
    }
  },
)

export const initializeSelectionEventsActionAtom = atom(
  null,
  async (get, set): Promise<void> => {
    if (eventCleanup) {
      return
    }

    const unlistenFns: Array<() => void> = []

    const selectionUnlisten = await listenEvent(SchaltEvent.Selection, payload => {
      const value = (payload as { selection?: Selection } | undefined)?.selection
      if (!value) return

      void (async () => {
        let target = value
        let targetIsSpec = false

        if (value.kind === 'session' && value.payload) {
          if (value.sessionState === 'spec') {
            targetIsSpec = true
          } else if (value.sessionState === undefined) {
            const snapshot = await set(getSessionSnapshotActionAtom, { sessionId: value.payload })
            if (snapshot) {
              target = {
                ...value,
                worktreePath: snapshot.worktreePath,
                sessionState: snapshot.sessionState,
              }
              targetIsSpec = snapshot.sessionState === 'spec'
            }
          }
        }

        const currentSelection = get(selectionAtom)
        const currentIsSpec = currentSelection.kind === 'session' && (currentSelection.sessionState ?? null) === 'spec'
        if (
          currentFilterMode === FilterMode.Running &&
          target.kind === 'session' &&
          target.payload &&
          targetIsSpec &&
          currentSelection.kind === 'session' &&
          !currentIsSpec
        ) {
          logger.info('[selection] ignoring backend spec selection under running filter', {
            sessionId: target.payload,
          })
          return
        }

        await set(setSelectionActionAtom, { selection: target, isIntentional: false })
      })()
    })
    unlistenFns.push(selectionUnlisten)

    const sessionsRefreshedUnlisten = await listenEvent(SchaltEvent.SessionsRefreshed, async payload => {
      const sessions = (payload as { info?: unknown }[] | undefined) ?? []
      if (Array.isArray(sessions)) {
        for (const item of sessions) {
          const info = (item as { info?: { session_id?: string; session_state?: string | null; status?: string; ready_to_merge?: boolean } })?.info
          if (!info?.session_id) {
            continue
          }
          const nextState = normalizeSessionState(info.session_state, info.status, info.ready_to_merge)
          await handleSessionStateUpdate(set as SetAtomFunction, info.session_id, nextState)
        }
      }
      const currentSelection = get(selectionAtom)
      if (currentSelection.kind !== 'session' || !currentSelection.payload) {
        return
      }

      const sessionId = currentSelection.payload
      let snapshot: SessionSnapshot | null = null

      if (Array.isArray(sessions)) {
        const matched = sessions
          .map(item => (item as { info?: { session_id?: string } })?.info)
          .find(info => info?.session_id === sessionId)

        if (matched) {
          try {
            const raw = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: sessionId })
            if (raw) {
              snapshot = snapshotFromRawSession(raw)
              sessionSnapshotsCache.set(sessionId, snapshot)
            }
          } catch (error) {
            logger.warn('[selection] Failed to refresh snapshot for session after SessionsRefreshed', { sessionId, error })
          }
        }
      }

      if (!snapshot) {
        snapshot = await set(getSessionSnapshotActionAtom, { sessionId, refresh: true })
      }

      if (!snapshot) {
        return
      }

      const latest = get(selectionAtom)
      if (latest.kind !== 'session' || latest.payload !== sessionId) {
        return
      }

      await set(setSelectionActionAtom, {
        selection: {
          ...latest,
          worktreePath: snapshot.worktreePath,
          sessionState: snapshot.sessionState,
        },
        isIntentional: false,
      })
    })
    unlistenFns.push(sessionsRefreshedUnlisten)

    const sessionStateUnlisten = await listenUiEvent(UiEvent.SessionStateChanged, payload => {
      const sessionId = (payload as { sessionId?: string } | undefined)?.sessionId
      if (!sessionId) return

      sessionSnapshotsCache.delete(sessionId)

      const currentSelection = get(selectionAtom)
      if (currentSelection.kind !== 'session' || currentSelection.payload !== sessionId) {
        return
      }

      const refreshPromise = (async () => {
        const snapshot = await set(getSessionSnapshotActionAtom, { sessionId, refresh: true })
        if (!snapshot) return
        if (snapshot.sessionState) {
          await handleSessionStateUpdate(set as SetAtomFunction, sessionId, snapshot.sessionState)
        }
        const latest = get(selectionAtom)
        if (latest.kind !== 'session' || latest.payload !== sessionId) {
          return
        }
        await set(setSelectionActionAtom, {
          selection: {
            ...latest,
            worktreePath: snapshot.worktreePath,
            sessionState: snapshot.sessionState,
          },
          isIntentional: false,
        })
      })()

      pendingAsyncEffect = refreshPromise.finally(() => {
        if (pendingAsyncEffect === refreshPromise) {
          pendingAsyncEffect = null
        }
      })
    })
    unlistenFns.push(sessionStateUnlisten)

    eventCleanup = () => {
      for (const unlisten of unlistenFns) {
        try {
          unlisten()
        } catch (error) {
          logger.warn('[selection] Failed to remove event listener', error)
        }
      }
      eventCleanup = null
    }
  },
)

export function resetSelectionAtomsForTest(): void {
  sessionSnapshotsCache.clear()
  sessionFetchPromises.clear()
  terminalsCache.clear()
  terminalToSelectionKey.clear()
  selectionsNeedingRecreate.clear()
  lastSelectionByProject.clear()
  lastKnownSessionState.clear()
  cachedProjectPath = null
  cachedProjectId = 'default'
  currentFilterMode = FilterMode.All
  if (eventCleanup) {
    eventCleanup()
  }
  eventCleanup = null
  pendingAsyncEffect = null
}

export async function waitForSelectionAsyncEffectsForTest(): Promise<void> {
  if (pendingAsyncEffect) {
    await pendingAsyncEffect
  }
}
