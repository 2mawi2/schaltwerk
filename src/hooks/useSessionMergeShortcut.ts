import { useCallback, useMemo } from 'react'

import { useSelection } from './useSelection'
import { useSessions } from './useSessions'
import { useModal } from '../contexts/ModalContext'
import { useToast } from '../common/toast/ToastProvider'
import type { ToastOptions } from '../common/toast/ToastProvider'
import { FilterMode } from '../types/sessionFilters'
import { getSessionDisplayName } from '../utils/sessionDisplayName'
import { logger } from '../utils/logger'
import type { ShortcutMergeResult } from '../store/atoms/sessions'
import type { EnrichedSession } from '../types/session'

type PushToast = (toast: ToastOptions) => void
type StartedMergeResult = Extract<ShortcutMergeResult, { status: 'started' }>
type NeedsModalMergeResult = Extract<ShortcutMergeResult, { status: 'needs-modal' }>
type BlockedMergeResult = Extract<ShortcutMergeResult, { status: 'blocked' }>
type ErrorMergeResult = Extract<ShortcutMergeResult, { status: 'error' }>

interface FilterPivotState {
  shouldPivot: boolean
  previousFilter: FilterMode | null
  applied: boolean
}

export interface UseSessionMergeShortcutOptions {
  /** Opt-in to automatically pivot from Running → All when a merge auto-marks a session ready. Defaults to false. */
  enableFilterPivot?: boolean
  /** Optional override for toast notifications (defaults to ToastProvider). */
  pushToast?: PushToast
  /** Optional override for checking modal visibility (defaults to ModalContext). */
  isAnyModalOpen?: () => boolean
  /** Pre-filled commit message drafts, keyed by session id. */
  commitMessageDrafts?: Record<string, string>
}

export interface UseSessionMergeShortcutResult {
  /** Execute the quick merge shortcut for the currently selected session. */
  handleMergeShortcut: () => Promise<void>
  /** Whether any session currently has a merge in-flight. */
  isMerging: boolean
  /** Query helper for components that need per-session merge status. */
  isSessionMerging: (sessionId: string) => boolean
}

const EMPTY_COMMIT_DRAFTS = Object.freeze({}) as Record<string, string>

function determineFilterPivot(
  currentFilter: FilterMode,
  readyToMerge: boolean,
  enabled: boolean
): FilterPivotState {
  const shouldPivot = enabled && currentFilter === FilterMode.Running && !readyToMerge
  return {
    shouldPivot,
    previousFilter: shouldPivot ? currentFilter : null,
    applied: false,
  }
}

function applyFilterPivot(pivotState: FilterPivotState, setFilterMode: (mode: FilterMode) => void) {
  if (!pivotState.shouldPivot || pivotState.applied) {
    return
  }
  setFilterMode(FilterMode.All)
  pivotState.applied = true
}

function restoreFilterMode(pivotState: FilterPivotState, setFilterMode: (mode: FilterMode) => void) {
  if (!pivotState.applied || pivotState.previousFilter === null) {
    return
  }
  setFilterMode(pivotState.previousFilter)
  pivotState.applied = false
}

function handleStartedResult(
  result: StartedMergeResult,
  session: EnrichedSession,
  pivotState: FilterPivotState,
  pushToast: PushToast,
  setFilterMode: (mode: FilterMode) => void,
) {
  if (result.autoMarkedReady) {
    applyFilterPivot(pivotState, setFilterMode)
  }

  pushToast({
    tone: 'info',
    title: `Merging ${getSessionDisplayName(session.info)}`,
    description: `Fast-forwarding ${session.info.base_branch ?? 'main'}...`,
  })

  if (result.autoMarkedReady && pivotState.shouldPivot) {
    pushToast({
      tone: 'info',
      title: 'Session moved to review',
      description: 'Switched to the "All" filter so the reviewed session stays visible. Switch back anytime.',
    })
  }
}

function handleNeedsModalResult(
  result: NeedsModalMergeResult,
  pivotState: FilterPivotState,
  setFilterMode: (mode: FilterMode) => void,
  pushToast: PushToast
) {
  if (result.autoMarkedReady) {
    applyFilterPivot(pivotState, setFilterMode)
  } else {
    restoreFilterMode(pivotState, setFilterMode)
  }

  if (result.reason === 'conflict') {
    pushToast({ tone: 'warning', title: 'Conflicts detected', description: 'Review conflicts in the merge dialog.' })
    return
  }

  if (result.reason === 'missing-commit') {
    pushToast({ tone: 'info', title: 'Commit message required', description: 'Review and confirm the merge details.' })
    return
  }

  if (result.reason === 'confirm' && result.autoMarkedReady) {
    pushToast({
      tone: 'info',
      title: 'Session ready to merge',
      description: 'Review the commit message before confirming the merge.',
    })
  }
}

function handleBlockedResult(
  result: BlockedMergeResult,
  session: EnrichedSession,
  pivotState: FilterPivotState,
  setFilterMode: (mode: FilterMode) => void,
  pushToast: PushToast
) {
  if (result.autoMarkedReady) {
    applyFilterPivot(pivotState, setFilterMode)
  } else {
    restoreFilterMode(pivotState, setFilterMode)
  }

  switch (result.reason) {
    case 'already-merged':
      pushToast({ tone: 'info', title: 'Nothing to merge', description: `${getSessionDisplayName(session.info)} is already up to date.` })
      return
    case 'in-flight':
      pushToast({ tone: 'info', title: 'Merge already running', description: `${getSessionDisplayName(session.info)} is merging elsewhere.` })
      return
    case 'no-session':
    case 'not-ready':
      pushToast({ tone: 'info', title: 'Select a reviewed session', description: 'Choose a reviewed session before merging.' })
      return
    default:
      return
  }
}

function handleErrorResult(
  result: ErrorMergeResult,
  pivotState: FilterPivotState,
  setFilterMode: (mode: FilterMode) => void,
  pushToast: PushToast
) {
  if (result.autoMarkedReady) {
    applyFilterPivot(pivotState, setFilterMode)
  }
  restoreFilterMode(pivotState, setFilterMode)
  pushToast({ tone: 'error', title: 'Merge failed', description: result.message })
}

/**
 * Hook that encapsulates the Cmd+Shift+M (quick merge) workflow so it can be reused
 * by any component (sidebar, context menu, toolbar buttons, etc.).
 *
 * Responsibilities:
 * 1. Validate that no modal is open and a session is selected
 * 2. Automatically pivot the filter from Running → All when auto-marking ready
 * 3. Restore the previous filter if the merge needs manual intervention or fails
 * 4. Surface contextual toast notifications for every quick-merge result
 *
 * @example
 * const { handleMergeShortcut } = useSessionMergeShortcut({ commitMessageDrafts })
 * return <Button onClick={handleMergeShortcut}>Quick Merge</Button>
 */
export function useSessionMergeShortcut(
  options?: UseSessionMergeShortcutOptions
): UseSessionMergeShortcutResult {
  const { selection } = useSelection()
  const {
    sessions,
    filterMode,
    setFilterMode,
    quickMergeSession,
    isMergeInFlight,
  } = useSessions()
  const { isAnyModalOpen: defaultModalCheck } = useModal()
  const { pushToast: defaultPushToast } = useToast()

  const isAnyModalOpen = options?.isAnyModalOpen ?? defaultModalCheck
  const pushToast = options?.pushToast ?? defaultPushToast
  const enableFilterPivot = options?.enableFilterPivot ?? false
  const commitMessageDrafts = useMemo(
    () => options?.commitMessageDrafts ?? EMPTY_COMMIT_DRAFTS,
    [options?.commitMessageDrafts],
  )

  const handleMergeShortcut = useCallback(async () => {
    if (isAnyModalOpen()) return
    if (selection.kind !== 'session' || !selection.payload) {
      return
    }

    const sessionId = selection.payload
    const session = sessions.find((s) => s.info.session_id === sessionId)
    if (!session) {
      return
    }

    if (isMergeInFlight(sessionId)) {
      pushToast({
        tone: 'info',
        title: 'Merge already running',
        description: `${getSessionDisplayName(session.info)} is already merging.`,
      })
      return
    }

    const commitDraft = commitMessageDrafts[sessionId]
    const pivotState = determineFilterPivot(
      filterMode,
      Boolean(session.info.ready_to_merge),
      enableFilterPivot,
    )

    try {
      const result = await quickMergeSession(sessionId, { commitMessage: commitDraft ?? null })

      switch (result.status) {
        case 'started':
          handleStartedResult(result, session, pivotState, pushToast, setFilterMode)
          return
        case 'needs-modal':
          handleNeedsModalResult(result, pivotState, setFilterMode, pushToast)
          return
        case 'blocked':
          handleBlockedResult(result, session, pivotState, setFilterMode, pushToast)
          return
        case 'error':
          handleErrorResult(result, pivotState, setFilterMode, pushToast)
          return
        default:
          return
      }
    } catch (error) {
      logger.error('Quick merge shortcut failed', error)
      restoreFilterMode(pivotState, setFilterMode)
      const message = error instanceof Error ? error.message : String(error)
      pushToast({ tone: 'error', title: 'Merge failed', description: message })
    }
  }, [
    commitMessageDrafts,
    enableFilterPivot,
    filterMode,
    isAnyModalOpen,
    isMergeInFlight,
    pushToast,
    quickMergeSession,
    selection,
    sessions,
    setFilterMode,
  ])

  const isMerging = useMemo(
    () => sessions.some((s) => isMergeInFlight(s.info.session_id)),
    [isMergeInFlight, sessions],
  )

  const isSessionMerging = useCallback(
    (sessionId: string) => isMergeInFlight(sessionId),
    [isMergeInFlight],
  )

  return {
    handleMergeShortcut,
    isMerging,
    isSessionMerging,
  }
}
