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
import { computeProjectOrchestratorId } from '../../common/agentSpawn'
import { logger } from '../../utils/logger'
import type { RawSession } from '../../types/session'
import { FilterMode } from '../../types/sessionFilters'
import { projectPathAtom } from './project'
import { scopedTerminalKey } from '../../common/scopeKeys'

export interface Selection {
  kind: 'session' | 'orchestrator'
  payload?: string
  worktreePath?: string
  sessionState?: 'spec' | 'processing' | 'running' | 'reviewed'
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
let currentFilterMode: FilterMode = FilterMode.Running
const projectFilterModes = new Map<string, FilterMode>()
let defaultFilterModeForProjects: FilterMode = FilterMode.Running
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
  if (selection.sessionState === 'processing') return false
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

  if (selection.kind === 'session' && (selection.sessionState === 'spec' || selection.sessionState === 'processing')) {
    return {
      top: '',
      bottomBase: '',
      workingDirectory: '',
    }
  }

  const group = sessionTerminalGroup(selection.payload)
  const workingDirectory = (selection.sessionState === 'running' || selection.sessionState === 'reviewed') && selection.worktreePath
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
      return state === 'running' || state === 'processing'
    case FilterMode.Reviewed:
      return state === 'reviewed'
    default:
      return state === 'running'
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
  if (state === 'spec' || state === 'processing' || state === 'running' || state === 'reviewed') {
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
// Keyed by `${projectPath ?? 'none'}::${terminalId}` to avoid cross-project collisions.
const terminalToSelectionKey = new Map<string, string>()
const terminalWorkingDirectory = new Map<string, string>()
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
    await set(clearTerminalTrackingActionAtom, { terminalIds: ids, projectPath })
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
  const scopedProject = projectPath ?? selection.projectPath ?? 'none'
  return `session:${scopedProject}:${selection.payload ?? 'unknown'}`
}

function sessionStateCacheKey(sessionId: string, projectPath: string | null): string {
  return `${projectPath ?? 'none'}::${sessionId}`
}

type TerminalCreationDecision = { shouldCreateTerminals: boolean; cleanupMissingWorktree: boolean }

async function validateSessionTerminalCreation(selection: Selection, cwd: string | undefined): Promise<TerminalCreationDecision> {
  if (!cwd) {
    logger.warn('[selection] Skipping terminal creation for session without worktree', {
      sessionId: selection.payload,
    })
    return { shouldCreateTerminals: false, cleanupMissingWorktree: false }
  }

  try {
    const worktreeExists = await invoke<boolean>(TauriCommands.PathExists, { path: cwd })
    if (!worktreeExists) {
      logger.warn('[selection] Worktree path does not exist; skipping terminal creation', {
        sessionId: selection.payload,
        worktreePath: cwd,
      })
      return { shouldCreateTerminals: false, cleanupMissingWorktree: true }
    }

    const gitDirExists = await invoke<boolean>(TauriCommands.PathExists, { path: `${cwd}/.git` })
    if (!gitDirExists) {
      logger.warn('[selection] Worktree missing git metadata; skipping terminal creation', {
        sessionId: selection.payload,
        worktreePath: cwd,
      })
      return { shouldCreateTerminals: false, cleanupMissingWorktree: true }
    }

    return { shouldCreateTerminals: true, cleanupMissingWorktree: false }
  } catch (error) {
    logger.warn('[selection] Failed to validate session worktree before creating terminals', {
      sessionId: selection.payload,
      error,
    })
    return { shouldCreateTerminals: false, cleanupMissingWorktree: false }
  }
}

async function validateOrchestratorTerminalCreation(cwd: string | undefined): Promise<TerminalCreationDecision> {
  if (!cwd) {
    logger.debug('[selection] Skipping orchestrator terminal creation without project path')
    return { shouldCreateTerminals: false, cleanupMissingWorktree: false }
  }

  try {
    const projectExists = await invoke<boolean>(TauriCommands.DirectoryExists, { path: cwd })
    if (!projectExists) {
      logger.warn('[selection] Project directory does not exist; skipping orchestrator terminal creation', {
        projectPath: cwd,
      })
      return { shouldCreateTerminals: false, cleanupMissingWorktree: false }
    }
    return { shouldCreateTerminals: true, cleanupMissingWorktree: false }
  } catch (error) {
    logger.warn('[selection] Failed to validate project directory before creating orchestrator terminals', {
      projectPath: cwd,
      error,
    })
    return { shouldCreateTerminals: false, cleanupMissingWorktree: false }
  }
}

async function evaluateTerminalCreation(selection: Selection, terminals: TerminalSet): Promise<TerminalCreationDecision> {
  if (selection.kind === 'session') {
    if (selection.sessionState === 'spec' || selection.sessionState === 'processing') {
      return { shouldCreateTerminals: false, cleanupMissingWorktree: false }
    }
    return validateSessionTerminalCreation(selection, terminals.workingDirectory)
  }

  return validateOrchestratorTerminalCreation(terminals.workingDirectory)
}


async function ensureTerminal(
  id: string,
  cwd: string,
  tracked: Set<string>,
  force: boolean,
  cacheKey: string,
  projectPath: string | null,
): Promise<void> {
  const isTestEnv = typeof process !== 'undefined' && process.env.NODE_ENV === 'test'

  const registryHasInstance = hasTerminalInstance(id)
  const backendHasInstance = isTestEnv ? registryHasInstance : await invoke<boolean>(TauriCommands.TerminalExists, { id }).catch(() => false)
  const scopedKey = scopedTerminalKey(projectPath, id)
  const currentOwnerKey = terminalToSelectionKey.get(scopedKey)
  const previousCwd = terminalWorkingDirectory.get(scopedKey)
  const cwdChanged = previousCwd !== undefined && previousCwd !== cwd
  const ownerMismatch = currentOwnerKey && currentOwnerKey !== cacheKey
  const hasOtherScopeOwner =
    !currentOwnerKey &&
    Array.from(terminalToSelectionKey.keys()).some(key => key !== scopedKey && key.endsWith(`::${id}`))
  const crossScopeRebind = hasOtherScopeOwner && !backendHasInstance && registryHasInstance
  let mustRecreate = force || cwdChanged || Boolean(ownerMismatch) || crossScopeRebind
  let pathMissing = false

  if (!mustRecreate && cwd) {
    try {
      const exists = await invoke<boolean>(TauriCommands.PathExists, { path: cwd })
      pathMissing = !exists
      mustRecreate = mustRecreate || pathMissing
      if (pathMissing) {
        logger.info('[selection] Detected missing worktree for terminal; forcing recreation', { id, cwd, cacheKey })
      }
    } catch (error) {
      logger.warn('[selection] Failed to verify worktree existence before reusing terminal', { id, error })
    }
  }

  if (!mustRecreate && tracked.has(id) && backendHasInstance) {
    return
  }

  if (mustRecreate) {
    if (registryHasInstance) {
      logger.info('[selection] Closing existing terminal before recreation', { id, cacheKey, cwd, previousCwd })
      try {
        await closeTerminalBackend(id)
      } catch (error) {
        logger.warn('[selection] Failed to close terminal during recreation', { id, error })
      }
    }

    if (currentOwnerKey && currentOwnerKey !== cacheKey) {
      const previousTracked = terminalsCache.get(currentOwnerKey)
      if (previousTracked) {
        previousTracked.delete(id)
        if (previousTracked.size === 0) {
          terminalsCache.delete(currentOwnerKey)
        }
      }
    }

    tracked.delete(id)
    terminalToSelectionKey.delete(scopedKey)
    terminalWorkingDirectory.delete(scopedKey)
  }

  if (!mustRecreate && backendHasInstance) {
    const logMessage = registryHasInstance
      ? '[selection] Rebinding existing terminal instance to selection cache'
      : '[selection] Tracking existing backend terminal without recreation'

    logger.info(logMessage, {
      id,
      cacheKey,
      cwd,
    })
    tracked.add(id)
    terminalToSelectionKey.set(scopedKey, cacheKey)
    terminalWorkingDirectory.set(scopedKey, cwd)
    return
  }

  if (isTestEnv) {
    tracked.add(id)
    terminalToSelectionKey.set(scopedKey, cacheKey)
    terminalWorkingDirectory.set(scopedKey, cwd)
    return
  }

  await createTerminalBackend({ id, cwd })
  tracked.add(id)
  terminalToSelectionKey.set(scopedKey, cacheKey)
  terminalWorkingDirectory.set(scopedKey, cwd)
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
    const trackedTopCwd = terminals.top
      ? terminalWorkingDirectory.get(scopedTerminalKey(projectPath, terminals.top))
      : undefined
    const trackedBottomCwd = terminals.bottomBase
      ? terminalWorkingDirectory.get(scopedTerminalKey(projectPath, terminals.bottomBase))
      : undefined
    const workingDirectoryChanged = Boolean(
      terminals.workingDirectory &&
      ((trackedTopCwd && trackedTopCwd !== terminals.workingDirectory) ||
        (trackedBottomCwd && trackedBottomCwd !== terminals.workingDirectory))
    )
    let effectiveForceRecreate = forceRecreate || pendingRecreate || workingDirectoryChanged
    let tracked = terminalsCache.get(cacheKey)
    if (!tracked) {
      tracked = new Set<string>()
      terminalsCache.set(cacheKey, tracked)
    }
    let missingTop = !tracked.has(terminals.top)
    let missingBottom = !tracked.has(terminals.bottomBase)

    const unchanged = !forceRecreate && selectionEquals(current, enrichedSelection)

    let cleanupTerminalsDueToMissingWorktree = false

    if (!unchanged) {
      set(selectionAtom, enrichedSelection)
    }

    const { shouldCreateTerminals, cleanupMissingWorktree } = await evaluateTerminalCreation(enrichedSelection, terminals)
    cleanupTerminalsDueToMissingWorktree = cleanupMissingWorktree

    const shouldTouchTerminals = effectiveForceRecreate || missingTop || missingBottom || cleanupTerminalsDueToMissingWorktree

    if (shouldTouchTerminals) {
      if (shouldCreateTerminals) {
        await Promise.all([
          ensureTerminal(terminals.top, terminals.workingDirectory, tracked, effectiveForceRecreate, cacheKey, projectPath ?? null),
          ensureTerminal(terminals.bottomBase, terminals.workingDirectory, tracked, effectiveForceRecreate, cacheKey, projectPath ?? null),
        ])
      }

      if (cleanupTerminalsDueToMissingWorktree) {
        await set(clearTerminalTrackingActionAtom, [terminals.top, terminals.bottomBase])
        selectionsNeedingRecreate.add(cacheKey)
        effectiveForceRecreate = true
        missingTop = true
        missingBottom = true
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
  async (get, _set, payload: { terminalIds: string[]; projectPath?: string | null } | string[]): Promise<void> => {
    const terminalIds = Array.isArray(payload) ? payload : payload.terminalIds
    const scopeProjectPath = Array.isArray(payload) ? get(projectPathAtom) : (payload.projectPath ?? get(projectPathAtom))
    try {
      for (const id of terminalIds) {
        try {
          await closeTerminalBackend(id)
        } catch (error) {
          logger.warn('[selection] Failed to close terminal during cleanup', { id, error })
        }

        // Always remove from registry, even if backend close failed (e.g. project closed)
        try {
          removeTerminalInstance(id)
        } catch (error) {
          logger.warn('[selection] Failed to dispose terminal instance during cleanup', { id, error })
        }

        const scopedKey = scopedTerminalKey(scopeProjectPath ?? null, id)
        const key = terminalToSelectionKey.get(scopedKey)
        if (!key) {
          terminalWorkingDirectory.delete(scopedKey)
          continue
        }
        selectionsNeedingRecreate.add(key)
        terminalToSelectionKey.delete(scopedKey)
        terminalWorkingDirectory.delete(scopedKey)
        const tracked = terminalsCache.get(key)
        if (!tracked) {
          continue
        }
        tracked.delete(id)
        if (tracked.size === 0) {
          terminalsCache.delete(key)
        }
      }
    } finally {
      try {
        const orchestratorTerminalId = computeProjectOrchestratorId(scopeProjectPath ?? null) ?? null
        const sessionTerminalIds = orchestratorTerminalId
          ? terminalIds.filter(id => id !== orchestratorTerminalId)
          : terminalIds
        if (sessionTerminalIds.length > 0) {
          if (orchestratorTerminalId) {
            clearTerminalStartedTracking(sessionTerminalIds, orchestratorTerminalId)
          } else {
            clearTerminalStartedTracking(sessionTerminalIds)
          }
        }
        if (orchestratorTerminalId && terminalIds.includes(orchestratorTerminalId)) {
          clearTerminalStartedTracking([orchestratorTerminalId])
        }
      } catch (error) {
        logger.warn('[selection] Failed to clear terminal started tracking during cleanup', { error })
      }
    }
  },
)

async function isWorktreeStillPresent(worktreePath: string): Promise<boolean> {
  try {
    const exists = await invoke<boolean>(TauriCommands.PathExists, { path: worktreePath })
    if (!exists) {
      return false
    }
    const gitDirExists = await invoke<boolean>(TauriCommands.PathExists, { path: `${worktreePath}/.git` })
    return gitDirExists
  } catch (error) {
    logger.warn('[selection] Failed to verify worktree removal during spec transition', {
      worktreePath,
      error,
    })
    return true
  }
}

async function handleSessionStateUpdate(
  set: SetAtomFunction,
  sessionId: string,
  nextState: NormalizedSessionState,
  projectPath: string | null,
): Promise<void> {
  const stateKey = sessionStateCacheKey(sessionId, projectPath)
  const previous = lastKnownSessionState.get(stateKey)
  const cacheKey = selectionCacheKey({ kind: 'session', payload: sessionId, projectPath }, projectPath)
  const tracked = terminalsCache.get(cacheKey)
  const isTracking = Boolean(tracked && tracked.size > 0)

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
        lastKnownSessionState.set(stateKey, 'running')
        return
      }
      if (snapshot && snapshot.sessionState === 'spec' && snapshot.worktreePath) {
        const stillPresent = await isWorktreeStillPresent(snapshot.worktreePath)
        if (stillPresent) {
          logger.warn('[selection] Spec event arrived but session worktree still exists; deferring terminal release.', {
            sessionId,
            projectPath,
            worktreePath: snapshot.worktreePath,
          })
          lastKnownSessionState.set(stateKey, 'running')
          return
        }
      }
    } catch (error) {
      logger.warn('[selection] Failed to verify session state during spec transition check', { sessionId, error })
    }

    logger.info('[selection] Confirmed transition to spec state. Releasing terminals.', {
      sessionId,
      projectPath,
    })
  }

  lastKnownSessionState.set(stateKey, nextState)

  if (nextState === 'spec' && previous !== 'spec') {
    const group = sessionTerminalGroup(sessionId)
    await set(clearTerminalTrackingActionAtom, [group.top, group.bottomBase])
    const cacheKey = selectionCacheKey({ kind: 'session', payload: sessionId, projectPath }, projectPath)
    selectionsNeedingRecreate.add(cacheKey)
  }
}

function findSpecReplacement(sessionsPayload: unknown[], previousId: string): { id: string; worktreePath?: string } | null {
  const normalizedPrev = previousId.trim()
  const candidates = sessionsPayload
    .map(item => (item as { info?: { session_id?: string; session_state?: string | null; status?: string; worktree_path?: string } })?.info)
    .filter(info => info && normalizeSessionState(info.session_state, info.status) === 'spec') as Array<{ session_id?: string; worktree_path?: string }>

  if (!candidates.length) return null

  const exact = candidates.find(info => info.session_id === normalizedPrev)
  if (exact?.session_id) {
    return { id: exact.session_id, worktreePath: exact.worktree_path ?? undefined }
  }

  const prefixed = candidates.find(info => info.session_id?.startsWith(`${normalizedPrev}-`))
  if (prefixed?.session_id) {
    return { id: prefixed.session_id, worktreePath: prefixed.worktree_path ?? undefined }
  }

  return null
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
        const replacement = Array.isArray(sessionsPayload) ? findSpecReplacement(sessionsPayload, sessionId) : null
        const terminals = computeTerminals(currentSelection, activeProjectPath)
        await set(clearTerminalTrackingActionAtom, [terminals.top, terminals.bottomBase])

        const fallbackSelection: Selection = replacement
          ? {
              kind: 'session',
              payload: replacement.id,
              sessionState: 'spec',
              worktreePath: replacement.worktreePath,
              projectPath: activeProjectPath ?? undefined,
            }
          : buildOrchestratorSelection(activeProjectPath)

        const force = fallbackSelection.kind === 'orchestrator' ? false : true
        await set(setSelectionActionAtom, {
          selection: fallbackSelection,
          forceRecreate: force,
          isIntentional: false,
          remember: Boolean(activeProjectPath),
          rememberProjectPath: activeProjectPath ?? undefined,
        })
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
        if (!snapshot) {
          const projectPath = get(projectPathAtom)
          const terminals = computeTerminals(currentSelection, projectPath)
          await set(clearTerminalTrackingActionAtom, [terminals.top, terminals.bottomBase])
          await set(setSelectionActionAtom, {
            selection: buildOrchestratorSelection(projectPath),
            forceRecreate: false,
            isIntentional: false,
            remember: Boolean(projectPath),
            rememberProjectPath: projectPath ?? undefined,
          })
          return
        }
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
  terminalWorkingDirectory.clear()
  selectionsNeedingRecreate.clear()
  lastSelectionByProject.clear()
  lastKnownSessionState.clear()
  // ignoredSpecReverts.clear()
  cachedProjectPath = null
  cachedProjectId = 'default'
  currentFilterMode = FilterMode.Running
  projectFilterModes.clear()
  defaultFilterModeForProjects = FilterMode.Running
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
