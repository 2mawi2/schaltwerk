import { atom } from 'jotai'
import type { Atom, WritableAtom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { ProjectTab, ProjectLifecycleStatus } from '../../common/projectTabs'
import { determineNextActiveTab } from '../../common/projectTabs'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'
import { logger } from '../../utils/logger'
import { cleanupOrchestratorTerminalsActionAtom, setProjectPathActionAtom } from './selection'
import { cleanupProjectSessionsCacheActionAtom } from './sessions'

type SetAtomFunction = <Value, Result>(
  atom: WritableAtom<unknown, [Value], Result>,
  value: Value,
) => Result

type GetAtomFunction = <Value>(atom: Atom<Value>) => Value

const baseProjectPathAtom = atom<string | null>(null)

export const projectPathAtom = atom(
  get => get(baseProjectPathAtom),
  (get, set, next: string | null) => {
    const current = get(baseProjectPathAtom)
    if (current === next) {
      return
    }
    set(baseProjectPathAtom, next)
  },
)

export interface ProjectEntry extends ProjectTab {
  status: ProjectLifecycleStatus
  lastError?: string
  lastOpenedAt: number
}

export type { ProjectLifecycleStatus } from '../../common/projectTabs'

const projectTabsInternalAtom = atom<ProjectEntry[]>([])
export const projectTabsAtom = atom(get => get(projectTabsInternalAtom))

interface ProjectSwitchState {
  inFlight: boolean
  target: string | null
}

const projectSwitchStateAtom = atom<ProjectSwitchState>({ inFlight: false, target: null })
export const projectSwitchStatusAtom = atom(get => get(projectSwitchStateAtom))

let inflightSwitch:
  | {
    promise: Promise<boolean>
    target: string
    abort: AbortController
  }
  | null = null

let switchQueue: Promise<unknown> = Promise.resolve()

function enqueueSwitch<T>(task: () => Promise<T>): Promise<T> {
  const run = async () => task()
  const chained = switchQueue.then(run, run) as Promise<T>
  switchQueue = chained.catch(error => {
    logger.debug('[projects] switch queue suppressed error', { error })
  })
  return chained
}

function projectNameFromPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function normalizePath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) {
    return ''
  }
  if (trimmed === '/' || /^[A-Za-z]:[\\/]{0,1}$/i.test(trimmed)) {
    return trimmed
  }
  return trimmed.replace(/[/\\]+$/, '')
}

function parsePermissionError(error: unknown): { message: string; isPermission: boolean } {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  const isPermission =
    message.includes('Permission required for folder:') ||
    lower.includes('permission denied') ||
    lower.includes('operation not permitted')

  return { message, isPermission }
}

function updateTabStatus(
  get: GetAtomFunction,
  set: SetAtomFunction,
  projectPath: string,
  updater: (entry: ProjectEntry) => ProjectEntry,
): void {
  const current = get(projectTabsInternalAtom)
  const next = current.map(entry => (entry.projectPath === projectPath ? updater(entry) : entry))
  set(projectTabsInternalAtom, next)
}

async function runProjectSwitch(set: SetAtomFunction, path: string): Promise<boolean> {
  if (!path) {
    return false
  }

  if (inflightSwitch) {
    if (inflightSwitch.target === path) {
      return inflightSwitch.promise
    }

    inflightSwitch.abort.abort()
    try {
      await inflightSwitch.promise
    } catch (error) {
      logger.debug('[projects] Previous switch aborted', { error })
    }
  }

  const abortController = new AbortController()
  const executeSwitch = async (): Promise<boolean> => {
    try {
      set(projectSwitchStateAtom, { inFlight: true, target: path })
      await invoke(TauriCommands.InitializeProject, { path })
      if (abortController.signal.aborted) {
        return false
      }
      await set(setProjectPathActionAtom, path)
      return true
    } catch (error) {
      const { message, isPermission } = parsePermissionError(error)
      logger.error('[projects] Failed to initialize project', { path, error })
      if (isPermission) {
        emitUiEvent(UiEvent.PermissionError, { error: message, path, source: 'project' })
      }
      return false
    }
  }

  const switchPromise = executeSwitch()

  inflightSwitch = {
    promise: switchPromise,
    target: path,
    abort: abortController,
  }

  void switchPromise.finally(() => {
    if (inflightSwitch?.promise === switchPromise) {
      inflightSwitch = null
      set(projectSwitchStateAtom, { inFlight: false, target: null })
    }
  })

  return switchPromise
}

async function recordRecentProject(path: string): Promise<void> {
  try {
    await invoke(TauriCommands.AddRecentProject, { path })
  } catch (error) {
    logger.warn('[projects] Failed to update recent projects', { path, error })
  }
}

function ensureTabEntry(get: GetAtomFunction, set: SetAtomFunction, path: string): void {
  const normalized = normalizePath(path)
  const existing = get(projectTabsInternalAtom).find(tab => tab.projectPath === normalized)
  if (existing) {
    return
  }

  const nextEntry: ProjectEntry = {
    projectPath: normalized,
    projectName: projectNameFromPath(normalized),
    status: 'initializing',
    lastOpenedAt: Date.now(),
  }

  const current = get(projectTabsInternalAtom)
  set(projectTabsInternalAtom, [...current, nextEntry])
}

export const openProjectActionAtom = atom(
  null,
  async (get, set, payload: { path: string }): Promise<boolean> => {
    const normalized = normalizePath(payload.path)
    if (!normalized) {
      return false
    }

    const existing = get(projectTabsInternalAtom).find(tab => tab.projectPath === normalized)
    if (!existing) {
      ensureTabEntry(get as GetAtomFunction, set as SetAtomFunction, normalized)
    }

    const currentPath = get(projectPathAtom)
    const switchState = get(projectSwitchStateAtom)
    const competingSwitch = Boolean(
      switchState.inFlight &&
      switchState.target &&
      switchState.target !== normalized
    )

    if (currentPath === normalized && !competingSwitch) {
      updateTabStatus(get as GetAtomFunction, set as SetAtomFunction, normalized, entry => ({
        ...entry,
        status: 'ready',
        lastError: undefined,
        lastOpenedAt: Date.now(),
      }))
      await recordRecentProject(normalized)
      return true
    }

    try {
      const switched = await enqueueSwitch(async () => {
        const currentPathNow = (get as GetAtomFunction)(projectPathAtom)
        const switchStateNow = (get as GetAtomFunction)(projectSwitchStateAtom)
        const competingSwitchNow = Boolean(
          switchStateNow.inFlight &&
          switchStateNow.target &&
          switchStateNow.target !== normalized
        )

        if (currentPathNow === normalized && !competingSwitchNow) {
          return true
        }

        return runProjectSwitch(set as SetAtomFunction, normalized)
      })
      if (!switched) {
        updateTabStatus(get as GetAtomFunction, set as SetAtomFunction, normalized, entry => ({
          ...entry,
          status: 'error',
          lastError: 'Project switch aborted',
        }))
        return false
      }

      updateTabStatus(get as GetAtomFunction, set as SetAtomFunction, normalized, entry => ({
        ...entry,
        status: 'ready',
        lastError: undefined,
        lastOpenedAt: Date.now(),
      }))

      await recordRecentProject(normalized)
      return true
    } catch (error) {
      logger.error('[projects] Failed to open project', { path: normalized, error })
      updateTabStatus(get as GetAtomFunction, set as SetAtomFunction, normalized, entry => ({
        ...entry,
        status: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      }))
      return false
    }
  },
)

export const selectProjectActionAtom = atom(
  null,
  async (get, set, payload: { path: string }): Promise<boolean> => {
    const normalized = normalizePath(payload.path)
    if (!normalized) {
      return false
    }

    const currentPath = get(projectPathAtom)
    const switchState = get(projectSwitchStateAtom)
    const competingSwitch = Boolean(
      switchState.inFlight &&
      switchState.target &&
      switchState.target !== normalized
    )

    if (currentPath === normalized && !competingSwitch) {
      return true
    }

    const existing = get(projectTabsInternalAtom).find(tab => tab.projectPath === normalized)
    if (!existing) {
      return set(openProjectActionAtom, { path: normalized })
    }

    updateTabStatus(get as GetAtomFunction, set as SetAtomFunction, normalized, entry => ({
      ...entry,
      status: 'switching',
    }))

    try {
      const switched = await enqueueSwitch(async () => {
        const currentPathNow = (get as GetAtomFunction)(projectPathAtom)
        const switchStateNow = (get as GetAtomFunction)(projectSwitchStateAtom)
        const competingSwitchNow = Boolean(
          switchStateNow.inFlight &&
          switchStateNow.target &&
          switchStateNow.target !== normalized
        )

        if (currentPathNow === normalized && !competingSwitchNow) {
          return true
        }

        return runProjectSwitch(set as SetAtomFunction, normalized)
      })
      if (!switched) {
        updateTabStatus(get as GetAtomFunction, set as SetAtomFunction, normalized, entry => ({
          ...entry,
          status: 'ready',
        }))
        return false
      }

      updateTabStatus(get as GetAtomFunction, set as SetAtomFunction, normalized, entry => ({
        ...entry,
        status: 'ready',
        lastError: undefined,
        lastOpenedAt: Date.now(),
      }))
      return true
    } catch (error) {
      logger.error('[projects] Failed to switch project', { path: normalized, error })
      updateTabStatus(get as GetAtomFunction, set as SetAtomFunction, normalized, entry => ({
        ...entry,
        status: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      }))
      return false
    }
  },
)

export interface CloseProjectResult {
  closed: boolean
  nextActivePath: string | null
}

export const closeProjectActionAtom = atom(
  null,
  async (get, set, payload: { path: string }): Promise<CloseProjectResult> => {
    const normalized = normalizePath(payload.path)
    if (!normalized) {
      return { closed: false, nextActivePath: get(projectPathAtom) }
    }

    const tabs = get(projectTabsInternalAtom)
    const closingIndex = tabs.findIndex(tab => tab.projectPath === normalized)
    if (closingIndex === -1) {
      return { closed: false, nextActivePath: get(projectPathAtom) }
    }

    const closingEntry = tabs[closingIndex]
    if (!closingEntry) {
      return { closed: false, nextActivePath: get(projectPathAtom) }
    }

    const restoreTab = (overrides: Partial<ProjectEntry>) => {
      const current = get(projectTabsInternalAtom)
      if (current.some(tab => tab.projectPath === normalized)) {
        return
      }
      const entry: ProjectEntry = {
        ...closingEntry,
        ...overrides,
      }
      const insertionIndex = Math.min(closingIndex, current.length)
      set(projectTabsInternalAtom, [
        ...current.slice(0, insertionIndex),
        entry,
        ...current.slice(insertionIndex),
      ])
    }

    // Optimistically remove the tab from the UI immediately. Cleanup (terminals/sessions) can take
    // a moment, and keeping the tab visible makes it feel like the close click didn't work.
    set(projectTabsInternalAtom, [
      ...tabs.slice(0, closingIndex),
      ...tabs.slice(closingIndex + 1),
    ])

    const activePath = get(projectPathAtom)
    const closingActive = activePath === normalized
    let nextActivePath = activePath

    if (closingActive) {
      const fallback = determineNextActiveTab(tabs, normalized)
      if (fallback) {
        const switched = await set(selectProjectActionAtom, { path: fallback.projectPath })
        if (!switched) {
          restoreTab({ status: 'ready', lastError: undefined })
          return { closed: false, nextActivePath: activePath }
        }
        nextActivePath = fallback.projectPath
      } else {
        await set(setProjectPathActionAtom, null)
        nextActivePath = null
      }
    }

    // Cleanup terminals and cache BEFORE closing the project on backend
    // This prevents "No active project" errors when trying to close terminals
    await set(cleanupOrchestratorTerminalsActionAtom, normalized)
    await set(cleanupProjectSessionsCacheActionAtom, normalized)

    try {
      await invoke(TauriCommands.CloseProject, { path: normalized })
    } catch (error) {
      logger.warn('[projects] Failed to close project', { path: normalized, error })
      restoreTab({
        status: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      })
      if (closingActive && nextActivePath === null) {
        await set(setProjectPathActionAtom, normalized)
      }
      return { closed: false, nextActivePath: get(projectPathAtom) }
    }

    const remaining = get(projectTabsInternalAtom).filter(tab => tab.projectPath !== normalized)
    set(projectTabsInternalAtom, remaining)

    if (!closingActive) {
      nextActivePath = get(projectPathAtom)
    }

    return { closed: true, nextActivePath }
  },
)

export const deactivateProjectActionAtom = atom(
  null,
  async (_get, set): Promise<void> => {
    await set(setProjectPathActionAtom, null)
  },
)

export function __resetProjectsTestingState(): void {
  if (inflightSwitch) {
    inflightSwitch.abort.abort()
    inflightSwitch = null
  }
  switchQueue = Promise.resolve()
}
