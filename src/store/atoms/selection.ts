import { atom } from 'jotai'
import type { WritableAtom } from 'jotai'
type SetAtomFunction = <Value, Result>(
  atom: WritableAtom<unknown, [Value], Result>,
  value: Value,
) => Result
import { invoke } from '@tauri-apps/api/core'
import { sessionTerminalGroup } from '../../common/terminalIdentity'
import { hasTerminalInstance, removeTerminalInstance } from '../../terminal/registry/terminalRegistry'
import { TauriCommands } from '../../common/tauriCommands'
import { emitUiEvent, listenUiEvent, UiEvent } from '../../common/uiEvents'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { createTerminalBackend, closeTerminalBackend } from '../../terminal/transport/backend'
import { clearTerminalStartedTracking } from '../../components/terminal/Terminal'
import { logger } from '../../utils/logger'
import type { RawSession } from '../../types/session'
import { FilterMode } from '../../types/sessionFilters'
import { projectPathAtom } from './project'

export interface Selection {
  kind: 'session' | 'orchestrator'
  payload?: string
  worktreePath?: string
  sessionState?: 'spec' | 'running' | 'reviewed'
  projectPath?: string | null
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
  projectPath?: string | null
}

const selectionAtom = atom<Selection>({ kind: 'orchestrator', projectPath: null })
let currentFilterMode: FilterMode = FilterMode.All
const projectFilterModes = new Map<string, FilterMode>()
let defaultFilterModeForProjects: FilterMode = FilterMode.All
let lastProcessedProjectPath: string | null = null

export const selectionValueAtom = atom(get => {
  const selection = get(selectionAtom)
  const projectPath = get(projectPathAtom)

  if (selection.kind === 'session') {
    if (!projectPath || selection.projectPath !== projectPath) {
      return buildOrchestratorSelection(projectPath ?? null)
    }
    return selection
  }

  if ((selection.projectPath ?? null) !== (projectPath ?? null)) {
    return buildOrchestratorSelection(projectPath ?? null)
  }

  return selection
})

export const isSpecAtom = atom(get => {
  const selection = get(selectionValueAtom)
  return selection.kind === 'session' && selection.sessionState === 'spec'
})

export const isReadyAtom = atom(get => {
  const selection = get(selectionValueAtom)
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
    return (a.projectPath ?? null) === (b.projectPath ?? null)
  }
  if (b.kind !== 'session') {
    return false
  }
  return (
    (a.payload ?? null) === (b.payload ?? null) &&
    (a.sessionState ?? null) === (b.sessionState ?? null) &&
    (a.worktreePath ?? null) === (b.worktreePath ?? null) &&
    (a.projectPath ?? null) === (b.projectPath ?? null)
  )
}

function rememberSelectionForProject(projectPath: string, selection: Selection): void {
  lastSelectionByProject.set(projectPath, { ...selection, projectPath })
}

function withProjectPath(selection: Selection, projectPath: string | null): Selection {
  if ((selection.projectPath ?? null) === (projectPath ?? null)) {
    return selection
  }
  return { ...selection, projectPath }
}

function buildOrchestratorSelection(projectPath: string | null): Selection {
  return { kind: 'orchestrator', projectPath }
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

export const terminalsAtom = atom<TerminalSet>(get => computeTerminals(get(selectionValueAtom), get(projectPathAtom)))

export const setSelectionFilterModeActionAtom = atom(
  null,
  (get, _set, mode: FilterMode) => {
    currentFilterMode = mode
    const projectPath = get(projectPathAtom)
    if (projectPath) {
      projectFilterModes.set(projectPath, mode)
    } else {
      defaultFilterModeForProjects = mode
    }
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
// const ignoredSpecReverts = new Set<string>() // Removed as part of fix
const lastSelectionByProject = new Map<string, Selection>()
let pendingAsyncEffect: Promise<void> | null = null

function getOrchestratorTerminalIds(projectPath: string | null): string[] {
  const tracked = terminalsCache.get(selectionCacheKey({ kind: 'orchestrator' }, projectPath))
  return tracked ? Array.from(tracked) : []
}

export const cleanupOrchestratorTerminalsActionAtom = atom(
  null,
  async (_get, set, projectPath: string | null) => {
    if (!projectPath) {
      return
    }
    const ids = getOrchestratorTerminalIds(projectPath)
    if (ids.length === 0) {
      return
    }
    await set(clearTerminalTrackingActionAtom, ids)
  },
)

let eventCleanup: (() => void) | null = null

export const getSessionSnapshotActionAtom = atom(
  null,
  async (get, _set, request: SnapshotRequest): Promise<SessionSnapshot | null> => {
    const { sessionId, refresh, projectPath: overrideProjectPath } = request
    if (!sessionId) return null

    const projectPath = overrideProjectPath ?? get(projectPathAtom)
    const cacheKey = sessionSnapshotCacheKey(sessionId, projectPath)

    if (!refresh) {
      const cached = sessionSnapshotsCache.get(cacheKey)
      if (cached) return cached
    } else {
      sessionSnapshotsCache.delete(cacheKey)
      sessionFetchPromises.delete(cacheKey)
    }

    const existing = sessionFetchPromises.get(cacheKey)
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
        sessionSnapshotsCache.set(cacheKey, snapshot)
        return snapshot
      } catch (error) {
        logger.warn('[selection] Failed to fetch session snapshot', error)
        return null
      } finally {
        sessionFetchPromises.delete(cacheKey)
      }
    })()

    sessionFetchPromises.set(cacheKey, fetchPromise)
    return fetchPromise
  },
)

function selectionCacheKey(selection: Selection, projectPath?: string | null): string {
  if (selection.kind === 'orchestrator') {
    return `orchestrator:${projectPath ?? 'none'}`
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

  const registryHasInstance = hasTerminalInstance(id)
  if (!force && registryHasInstance) {
    logger.info('[selection] Rebinding existing terminal instance to selection cache', {
      id,
      cacheKey,
      cwd,
    })
    tracked.add(id)
    terminalToSelectionKey.set(id, cacheKey)
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

  if (force && registryHasInstance) {
    logger.info('[selection] Closing existing registry terminal before recreation', { id, cacheKey })
    try {
      await closeTerminalBackend(id)
    } catch (error) {
      logger.warn('[selection] Failed to close registry terminal during force recreate', { id, error })
    }
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

    const assignedProjectPath = rememberTargetProject ?? projectPath ?? null
    const enrichedSelection = withProjectPath(resolvedSelection, assignedProjectPath)

    const rememberSelectionIfNeeded = () => {
      if (!shouldRemember || rememberApplied || !rememberTargetProject) {
        return
      }
      rememberApplied = true
      rememberSelectionForProject(rememberTargetProject, enrichedSelection)
    }

    const terminals = computeTerminals(enrichedSelection, projectPath)
    const cacheKey = selectionCacheKey(enrichedSelection, projectPath)
    const pendingRecreate = selectionsNeedingRecreate.has(cacheKey)
    const effectiveForceRecreate = forceRecreate || pendingRecreate
    let tracked = terminalsCache.get(cacheKey)
    if (!tracked) {
      tracked = new Set<string>()
      terminalsCache.set(cacheKey, tracked)
    }
    const missingTop = !tracked.has(terminals.top)
    const missingBottom = !tracked.has(terminals.bottomBase)

    const unchanged = !forceRecreate && selectionEquals(current, enrichedSelection)

    if (!unchanged) {
      set(selectionAtom, enrichedSelection)
    }

    if (effectiveForceRecreate || missingTop || missingBottom) {
      let shouldCreateTerminals = true

      if (enrichedSelection.kind === 'session') {
        if (enrichedSelection.sessionState === 'spec') {
          shouldCreateTerminals = false
        } else {
          const cwd = terminals.workingDirectory
          if (!cwd) {
            logger.warn('[selection] Skipping terminal creation for session without worktree', {
              sessionId: enrichedSelection.payload,
            })
            shouldCreateTerminals = false
          } else {
            try {
              const worktreeExists = await invoke<boolean>(TauriCommands.PathExists, { path: cwd })
              if (!worktreeExists) {
                logger.warn('[selection] Worktree path does not exist; skipping terminal creation', {
                  sessionId: enrichedSelection.payload,
                  worktreePath: cwd,
                })
                shouldCreateTerminals = false
              } else {
                const gitDirExists = await invoke<boolean>(TauriCommands.PathExists, { path: `${cwd}/.git` })
                if (!gitDirExists) {
                  logger.warn('[selection] Worktree missing git metadata; skipping terminal creation', {
                    sessionId: enrichedSelection.payload,
                    worktreePath: cwd,
                  })
                  shouldCreateTerminals = false
                }
              }
            } catch (error) {
              logger.warn('[selection] Failed to validate session worktree before creating terminals', {
                sessionId: enrichedSelection.payload,
                error,
              })
              shouldCreateTerminals = false
            }
          }
        }
      } else {
        const cwd = terminals.workingDirectory
        if (!cwd) {
          logger.debug('[selection] Skipping orchestrator terminal creation without project path')
          shouldCreateTerminals = false
        } else {
          try {
            const projectExists = await invoke<boolean>(TauriCommands.DirectoryExists, { path: cwd })
            if (!projectExists) {
              logger.warn('[selection] Project directory does not exist; skipping orchestrator terminal creation', {
                projectPath: cwd,
              })
              shouldCreateTerminals = false
            }
          } catch (error) {
            logger.warn('[selection] Failed to validate project directory before creating orchestrator terminals', {
              projectPath: cwd,
              error,
            })
            shouldCreateTerminals = false
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
        emitUiEvent(UiEvent.SelectionChanged, enrichedSelection)
      }
      return
    }

    rememberSelectionIfNeeded()
    if (isIntentional) {
      emitUiEvent(UiEvent.SelectionChanged, enrichedSelection)
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
      // Always remove from registry, even if backend close failed (e.g. project closed)
      removeTerminalInstance(id)

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
    clearTerminalStartedTracking(terminalIds)
  },
)

async function handleSessionStateUpdate(
  set: SetAtomFunction,
  sessionId: string,
  nextState: NormalizedSessionState,
  projectPath: string | null,
): Promise<void> {
  const previous = lastKnownSessionState.get(sessionId)
  const cacheKey = selectionCacheKey({ kind: 'session', payload: sessionId, projectPath }, projectPath)
  const isTracking = terminalsCache.has(cacheKey)

  if (nextState === 'spec' && (previous === 'running' || isTracking)) {
    // When we receive a spec state for a running session, it might be a stale event
    // (e.g. from a slow refresh or out-of-order event). We must verify the true state
    // before destroying terminals.
    try {
      const snapshot = await set(getSessionSnapshotActionAtom, { sessionId, refresh: true })
      if (snapshot && snapshot.sessionState === 'running') {
        logger.warn('[selection] Ignoring stale spec event. Backend verification confirms session is still running.', {
          sessionId,
          projectPath,
        })
        // Force local state to remain running so subsequent correct events are processed normally
        lastKnownSessionState.set(sessionId, 'running')
        return
      }
    } catch (error) {
      logger.warn('[selection] Failed to verify session state during spec transition check', { sessionId, error })
    }
    
    logger.info('[selection] Confirmed transition to spec state. Releasing terminals.', {
      sessionId,
      projectPath,
    })
  }

  lastKnownSessionState.set(sessionId, nextState)

  if (nextState === 'spec' && previous !== 'spec') {
    const group = sessionTerminalGroup(sessionId)
    await set(clearTerminalTrackingActionAtom, [group.top, group.bottomBase])
    const cacheKey = selectionCacheKey({ kind: 'session', payload: sessionId, projectPath }, projectPath)
    selectionsNeedingRecreate.add(cacheKey)
  }
}

export const setProjectPathActionAtom = atom(
  null,
  async (get, set, path: string | null) => {
    const previouslyHandledPath = lastProcessedProjectPath
    const currentGlobal = get(projectPathAtom)
    if (currentGlobal !== path) {
      set(projectPathAtom, path)
    }

    if (previouslyHandledPath === path) {
      return
    }

    currentFilterMode = path ? (projectFilterModes.get(path) ?? defaultFilterModeForProjects) : defaultFilterModeForProjects

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
        const enriched = withProjectPath(sanitized, project)
        rememberSelectionForProject(project, enriched)
        return { selection: enriched, hadRemembered: true }
      }

      const orchestratorSelection = buildOrchestratorSelection(project)
      rememberSelectionForProject(project, orchestratorSelection)
      return { selection: orchestratorSelection, hadRemembered: true }
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
      forceRecreate: false,
      isIntentional: false,
      remember: false,
      rememberProjectPath: path ?? undefined,
    })

    lastProcessedProjectPath = path

    if (previouslyHandledPath !== path) {
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
      const scoped = payload as { projectPath?: string | null; sessions?: unknown }
      const payloadProjectPath = typeof scoped?.projectPath === 'string' ? scoped.projectPath : null
      const sessionsPayload = Array.isArray(scoped?.sessions)
        ? scoped.sessions
        : Array.isArray(payload)
          ? (payload as unknown[])
          : []

      const activeProjectPath = get(projectPathAtom)
      if (payloadProjectPath && activeProjectPath && payloadProjectPath !== activeProjectPath) {
        return
      }

      if (Array.isArray(sessionsPayload)) {
        for (const item of sessionsPayload) {
          const info = (item as { info?: { session_id?: string; session_state?: string | null; status?: string; ready_to_merge?: boolean } })?.info
          if (!info?.session_id) {
            continue
          }
          const nextState = normalizeSessionState(info.session_state, info.status, info.ready_to_merge)
          await handleSessionStateUpdate(set as SetAtomFunction, info.session_id, nextState, get(projectPathAtom))
        }
      }
      const currentSelection = get(selectionAtom)
      if (currentSelection.kind !== 'session' || !currentSelection.payload) {
        return
      }

      const sessionId = currentSelection.payload
      let snapshot: SessionSnapshot | null = null

      if (Array.isArray(sessionsPayload)) {
        const matched = sessionsPayload
          .map(item => (item as { info?: { session_id?: string } })?.info)
          .find(info => info?.session_id === sessionId)

        if (matched) {
          try {
            const raw = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: sessionId })
            if (raw) {
              snapshot = snapshotFromRawSession(raw)
              const cacheKey = sessionSnapshotCacheKey(sessionId, get(projectPathAtom))
              sessionSnapshotsCache.set(cacheKey, snapshot)
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

      const cacheKey = sessionSnapshotCacheKey(sessionId, get(projectPathAtom))
      sessionSnapshotsCache.delete(cacheKey)

      const currentSelection = get(selectionAtom)
      if (currentSelection.kind !== 'session' || currentSelection.payload !== sessionId) {
        return
      }

      const refreshPromise = (async () => {
        const snapshot = await set(getSessionSnapshotActionAtom, { sessionId, refresh: true })
        if (!snapshot) return
        if (snapshot.sessionState) {
          await handleSessionStateUpdate(set as SetAtomFunction, sessionId, snapshot.sessionState, get(projectPathAtom))
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
  // ignoredSpecReverts.clear()
  cachedProjectPath = null
  cachedProjectId = 'default'
  currentFilterMode = FilterMode.All
  projectFilterModes.clear()
  defaultFilterModeForProjects = FilterMode.All
  lastProcessedProjectPath = null
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

export function getFilterModeForProjectForTest(projectPath: string | null): FilterMode {
  if (!projectPath) {
    return defaultFilterModeForProjects
  }
  return projectFilterModes.get(projectPath) ?? defaultFilterModeForProjects
}
function sessionSnapshotCacheKey(sessionId: string, projectPath: string | null): string {
  return `${projectPath ?? 'none'}::${sessionId}`
}
