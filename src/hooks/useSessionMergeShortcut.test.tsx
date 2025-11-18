import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EnrichedSession } from '../types/session'
import { FilterMode } from '../types/sessionFilters'
import type { MergeDialogState } from '../store/atoms/sessions'
import { useSessionMergeShortcut } from './useSessionMergeShortcut'

const useSessionsMock = vi.fn()
const useSelectionMock = vi.fn()
const useModalMock = vi.fn()
const pushToastMock = vi.fn()

vi.mock('./useSessions', () => ({
  useSessions: () => useSessionsMock(),
}))

vi.mock('./useSelection', () => ({
  useSelection: () => useSelectionMock(),
}))

vi.mock('../contexts/ModalContext', () => ({
  useModal: () => useModalMock(),
}))

vi.mock('../common/toast/ToastProvider', () => ({
  useToast: () => ({ pushToast: pushToastMock }),
}))

vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

function createSession(overrides: Partial<EnrichedSession['info']> = {}): EnrichedSession {
  return {
    info: {
      session_id: 'session-1',
      display_name: 'Session One',
      branch: 'para/session-one',
      worktree_path: '/tmp/session-one',
      base_branch: 'main',
      status: 'active',
      session_state: 'reviewed',
      ready_to_merge: true,
      is_current: false,
      session_type: 'worktree',
      ...overrides,
    },
    terminals: [],
  }
}

function createMergeDialogState(overrides: Partial<MergeDialogState> = {}): MergeDialogState {
  return {
    isOpen: false,
    status: 'idle',
    sessionName: null,
    preview: null,
    ...overrides,
  }
}

describe('useSessionMergeShortcut', () => {
  const quickMergeSession = vi.fn()
  const setFilterMode = vi.fn()
  const isMergeInFlight = vi.fn()
  const isAnyModalOpen = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    const session = createSession()
    quickMergeSession.mockResolvedValue({ status: 'needs-modal', reason: 'confirm' })
    setFilterMode.mockReset()
    isMergeInFlight.mockReturnValue(false)
    isAnyModalOpen.mockReturnValue(false)

    useSelectionMock.mockReturnValue({
      selection: { kind: 'session', payload: 'session-1' },
    })

    useSessionsMock.mockReturnValue({
      sessions: [session],
      allSessions: [session],
      quickMergeSession,
      filterMode: FilterMode.Running,
      setFilterMode,
      mergeDialogState: createMergeDialogState(),
      isMergeInFlight,
    })

    useModalMock.mockReturnValue({
      isAnyModalOpen,
    })
  })

  it('skips merging when no session is selected', async () => {
    useSelectionMock.mockReturnValueOnce({ selection: { kind: 'orchestrator' } })

    const { result } = renderHook(() => useSessionMergeShortcut())

    await act(async () => {
      await result.current.handleMergeShortcut()
    })

    expect(quickMergeSession).not.toHaveBeenCalled()
  })

  it('prevents duplicate merges when session is already running', async () => {
    isMergeInFlight.mockReturnValueOnce(true)
    const { result } = renderHook(() => useSessionMergeShortcut())

    await act(async () => {
      await result.current.handleMergeShortcut()
    })

    expect(pushToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Merge already running' }),
    )
    expect(quickMergeSession).not.toHaveBeenCalled()
  })

  it('keeps filter steady by default even after auto-marking ready', async () => {
    quickMergeSession.mockResolvedValueOnce({ status: 'needs-modal', reason: 'confirm' })
    const { result } = renderHook(() => useSessionMergeShortcut())

    await act(async () => {
      await result.current.handleMergeShortcut()
    })

    expect(setFilterMode).not.toHaveBeenCalled()
    expect(quickMergeSession).toHaveBeenCalledWith('session-1', { commitMessage: null })
  })

  it('does not pivot filter even when filter pivot opt-in is on (no auto-ready)', async () => {
    quickMergeSession.mockResolvedValueOnce({ status: 'needs-modal', reason: 'confirm' })
    const { result } = renderHook(() =>
      useSessionMergeShortcut({ enableFilterPivot: true }),
    )

    await act(async () => {
      await result.current.handleMergeShortcut()
    })

    expect(setFilterMode).not.toHaveBeenCalled()
  })

  it('passes cached commit drafts into quick merges', async () => {
    quickMergeSession.mockResolvedValueOnce({ status: 'needs-modal', reason: 'confirm' })
    const getCommitDraftForSession = vi.fn().mockReturnValue('cached message')
    const { result } = renderHook(() =>
      useSessionMergeShortcut({ getCommitDraftForSession }),
    )

    await act(async () => {
      await result.current.handleMergeShortcut()
    })

    expect(getCommitDraftForSession).toHaveBeenCalledWith('session-1')
    expect(quickMergeSession).toHaveBeenCalledWith('session-1', { commitMessage: 'cached message' })
  })

  it('treats merge dialog running state as merging for target session', () => {
    const session = createSession()
    useSessionsMock.mockReturnValueOnce({
      sessions: [session],
      allSessions: [session],
      quickMergeSession,
      filterMode: FilterMode.All,
      setFilterMode,
      mergeDialogState: createMergeDialogState({ status: 'running', sessionName: 'session-1' }),
      isMergeInFlight,
    })

    const { result } = renderHook(() => useSessionMergeShortcut())

    expect(result.current.isSessionMerging('session-1')).toBe(true)
  })
})
