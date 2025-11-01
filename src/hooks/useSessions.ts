import { useMemo, useCallback } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { AGENT_TYPES, type AgentType, type EnrichedSession } from '../types/session'
import type { SortMode, FilterMode } from '../types/sessionFilters'
import type { MergeDialogState, MergeStatus } from '../store/atoms/sessions'
import {
  allSessionsAtom,
  sessionsAtom,
  filteredSessionsAtom,
  sortedSessionsAtom,
  sessionsLoadingAtom,
  sortModeAtom,
  filterModeAtom,
  searchQueryAtom,
  isSearchVisibleAtom,
  setCurrentSelectionActionAtom,
  reloadSessionsActionAtom,
  optimisticallyConvertSessionToSpecActionAtom,
  updateSessionStatusActionAtom,
  createDraftActionAtom,
  enqueuePendingStartupActionAtom,
  updateSessionSpecContentActionAtom,
  mergeDialogAtom,
  openMergeDialogActionAtom,
  closeMergeDialogActionAtom,
  confirmMergeActionAtom,
  mergeInFlightSelectorAtom,
  mergeStatusSelectorAtom,
  autoCancelAfterMergeAtom,
  updateAutoCancelAfterMergeActionAtom,
  beginSessionMutationActionAtom,
  endSessionMutationActionAtom,
  sessionMutationSelectorAtom,
} from '../store/atoms/sessions'

export interface UseSessionsResult {
  sessions: EnrichedSession[]
  allSessions: EnrichedSession[]
  filteredSessions: EnrichedSession[]
  sortedSessions: EnrichedSession[]
  loading: boolean
  sortMode: SortMode
  setSortMode: (mode: SortMode) => void
  filterMode: FilterMode
  setFilterMode: (mode: FilterMode) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  isSearchVisible: boolean
  setIsSearchVisible: (visible: boolean) => void
  setCurrentSelection: (sessionId: string | null) => void
  reloadSessions: () => Promise<void>
  optimisticallyConvertSessionToSpec: (sessionId: string) => void
  updateSessionStatus: (sessionId: string, status: 'spec' | 'active' | 'dirty') => Promise<void>
  createDraft: (name: string, content: string) => Promise<void>
  enqueuePendingStartup: (sessionId: string, agentType?: string | null, ttlMs?: number) => Promise<void>
  updateSessionSpecContent: (sessionId: string, content: string) => void
  mergeDialogState: MergeDialogState
  openMergeDialog: (sessionId: string) => Promise<void>
  closeMergeDialog: () => void
  confirmMerge: (sessionId: string, mode: 'squash' | 'reapply', commitMessage?: string) => Promise<void>
  isMergeInFlight: (sessionId: string) => boolean
  getMergeStatus: (sessionId: string) => MergeStatus
  autoCancelAfterMerge: boolean
  updateAutoCancelAfterMerge: (value: boolean, persist?: boolean) => Promise<void>
  beginSessionMutation: (sessionId: string, kind: 'merge' | 'remove') => void
  endSessionMutation: (sessionId: string, kind: 'merge' | 'remove') => void
  isSessionMutating: (sessionId: string, kind?: 'merge' | 'remove') => boolean
}

export function useSessions(): UseSessionsResult {
  const sessions = useAtomValue(sessionsAtom)
  const allSessions = useAtomValue(allSessionsAtom)
  const filteredSessions = useAtomValue(filteredSessionsAtom)
  const sortedSessions = useAtomValue(sortedSessionsAtom)
  const loading = useAtomValue(sessionsLoadingAtom)
  const [sortMode, setSortMode] = useAtom(sortModeAtom)
  const [filterMode, setFilterMode] = useAtom(filterModeAtom)
  const [searchQuery, setSearchQuery] = useAtom(searchQueryAtom)
  const [isSearchVisible, setIsSearchVisible] = useAtom(isSearchVisibleAtom)

  const setCurrentSelection = useSetAtom(setCurrentSelectionActionAtom)
  const reloadSessionsAtom = useSetAtom(reloadSessionsActionAtom)
  const optimisticallyConvertSessionToSpec = useSetAtom(optimisticallyConvertSessionToSpecActionAtom)
  const updateSessionStatusAtom = useSetAtom(updateSessionStatusActionAtom)
  const createDraftAtom = useSetAtom(createDraftActionAtom)
  const enqueuePendingStartup = useSetAtom(enqueuePendingStartupActionAtom)
  const updateSessionSpecContent = useSetAtom(updateSessionSpecContentActionAtom)
  const mergeDialogState = useAtomValue(mergeDialogAtom)
  const openMergeDialogAtom = useSetAtom(openMergeDialogActionAtom)
  const closeMergeDialogAtom = useSetAtom(closeMergeDialogActionAtom)
  const confirmMergeAtom = useSetAtom(confirmMergeActionAtom)
  const mergeInFlightSelector = useAtomValue(mergeInFlightSelectorAtom)
  const mergeStatusSelector = useAtomValue(mergeStatusSelectorAtom)
  const autoCancelAfterMerge = useAtomValue(autoCancelAfterMergeAtom)
  const updateAutoCancelAfterMergeAtom = useSetAtom(updateAutoCancelAfterMergeActionAtom)
  const beginSessionMutationAtom = useSetAtom(beginSessionMutationActionAtom)
  const endSessionMutationAtom = useSetAtom(endSessionMutationActionAtom)
  const sessionMutationSelector = useAtomValue(sessionMutationSelectorAtom)

  const reloadSessions = useCallback(() => reloadSessionsAtom(), [reloadSessionsAtom])

  const updateSessionStatus = useCallback(async (sessionId: string, newStatus: 'spec' | 'active' | 'dirty') => {
    await updateSessionStatusAtom({ sessionId, status: newStatus })
  }, [updateSessionStatusAtom])

  const createDraft = useCallback(async (name: string, content: string) => {
    await createDraftAtom({ name, content })
  }, [createDraftAtom])

  const enqueuePendingStartupWrapped = useCallback(
    async (sessionId: string, agentType?: string | null, ttlMs?: number) => {
      const normalizedAgent: AgentType | undefined = agentType && AGENT_TYPES.includes(agentType as AgentType)
        ? (agentType as AgentType)
        : undefined
      await enqueuePendingStartup({ sessionId, agentType: normalizedAgent, ttlMs })
    },
    [enqueuePendingStartup],
  )

  const updateSessionSpecContentWrapped = useCallback(
    (sessionId: string, content: string) => {
      updateSessionSpecContent({ sessionId, content })
    },
    [updateSessionSpecContent],
  )

  const openMergeDialog = useCallback(async (sessionId: string) => {
    await openMergeDialogAtom(sessionId)
  }, [openMergeDialogAtom])

  const closeMergeDialog = useCallback(() => {
    closeMergeDialogAtom()
  }, [closeMergeDialogAtom])

  const confirmMerge = useCallback(async (sessionId: string, mode: 'squash' | 'reapply', commitMessage?: string) => {
    await confirmMergeAtom({ sessionId, mode, commitMessage })
  }, [confirmMergeAtom])

  const getMergeStatus = useCallback(
    (sessionId: string) => mergeStatusSelector(sessionId) ?? 'idle',
    [mergeStatusSelector],
  )
  const isMergeInFlight = useCallback((sessionId: string) => mergeInFlightSelector(sessionId), [mergeInFlightSelector])
  const isSessionMutating = useCallback(
    (sessionId: string, kind: 'merge' | 'remove' = 'merge') => sessionMutationSelector(sessionId, kind),
    [sessionMutationSelector],
  )

  const updateAutoCancelAfterMerge = useCallback(async (value: boolean, persist: boolean = true) => {
    await updateAutoCancelAfterMergeAtom({ value, persist })
  }, [updateAutoCancelAfterMergeAtom])

  const beginSessionMutation = useCallback((sessionId: string, kind: 'merge' | 'remove') => {
    beginSessionMutationAtom({ sessionId, kind })
  }, [beginSessionMutationAtom])

  const endSessionMutation = useCallback((sessionId: string, kind: 'merge' | 'remove') => {
    endSessionMutationAtom({ sessionId, kind })
  }, [endSessionMutationAtom])

  return useMemo(() => ({
    sessions,
    allSessions,
    filteredSessions,
    sortedSessions,
    loading,
    sortMode,
    setSortMode,
    filterMode,
    setFilterMode,
    searchQuery,
    setSearchQuery,
    isSearchVisible,
    setIsSearchVisible,
    setCurrentSelection,
    reloadSessions,
    optimisticallyConvertSessionToSpec,
    updateSessionStatus,
    createDraft,
    enqueuePendingStartup: enqueuePendingStartupWrapped,
    updateSessionSpecContent: updateSessionSpecContentWrapped,
    mergeDialogState,
    openMergeDialog,
    closeMergeDialog,
    confirmMerge,
    isMergeInFlight,
    getMergeStatus,
    autoCancelAfterMerge,
    updateAutoCancelAfterMerge,
    beginSessionMutation,
    endSessionMutation,
    isSessionMutating,
  }), [
    sessions,
    allSessions,
    filteredSessions,
    sortedSessions,
    loading,
    sortMode,
    setSortMode,
    filterMode,
    setFilterMode,
    searchQuery,
    setSearchQuery,
    isSearchVisible,
    setIsSearchVisible,
    setCurrentSelection,
    reloadSessions,
    optimisticallyConvertSessionToSpec,
    updateSessionStatus,
    createDraft,
    enqueuePendingStartupWrapped,
    updateSessionSpecContentWrapped,
    mergeDialogState,
    openMergeDialog,
    closeMergeDialog,
    confirmMerge,
    isMergeInFlight,
    getMergeStatus,
    autoCancelAfterMerge,
    updateAutoCancelAfterMerge,
    beginSessionMutation,
    endSessionMutation,
    isSessionMutating,
  ])
}
