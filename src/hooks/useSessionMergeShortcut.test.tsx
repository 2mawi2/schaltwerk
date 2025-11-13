import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { EnrichedSession } from '../types/session'
import type { ShortcutMergeResult } from '../store/atoms/sessions'
import { FilterMode } from '../types/sessionFilters'

const useSelectionMock = vi.fn()
const useSessionsMock = vi.fn()
const useModalMock = vi.fn()
const useToastMock = vi.fn()

vi.mock('./useSelection', () => ({
  useSelection: () => useSelectionMock(),
}))

vi.mock('./useSessions', () => ({
  useSessions: () => useSessionsMock(),
}))

vi.mock('../contexts/ModalContext', () => ({
  useModal: () => useModalMock(),
}))

vi.mock('../common/toast/ToastProvider', () => ({
  useToast: () => useToastMock(),
}))

vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

import { useSessionMergeShortcut, type UseSessionMergeShortcutResult } from './useSessionMergeShortcut'

async function runMergeShortcut(result: { current: UseSessionMergeShortcutResult }) {
  await act(async () => {
    await result.current.handleMergeShortcut()
  })
}

function createSession(
  id: string,
  overrides?: Partial<EnrichedSession['info']>
): EnrichedSession {
  return {
    info: {
      session_id: id,
      display_name: id,
      spec_content: '',
      branch: `schaltwerk/${id}`,
      worktree_path: `/tmp/${id}`,
      base_branch: 'main',
      status: 'active',
      session_state: 'running',
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
      has_uncommitted_changes: false,
      is_current: false,
      session_type: 'worktree',
      container_status: undefined,
      original_agent_type: undefined,
      current_task: '',
      diff_stats: undefined,
      ready_to_merge: false,
      version_group_id: undefined,
      version_number: undefined,
      merge_has_conflicts: false,
      has_conflicts: false,
      merge_conflicting_paths: [],
      merge_is_up_to_date: false,
      ...overrides,
    },
    status: undefined,
    terminals: [],
  }
}

describe('useSessionMergeShortcut', () => {
  let mockPushToast: ReturnType<typeof vi.fn>
  let mockIsAnyModalOpen: ReturnType<typeof vi.fn>
  let mockQuickMergeSession: ReturnType<typeof vi.fn>
  let mockIsMergeInFlight: ReturnType<typeof vi.fn>
  let mockSetFilterMode: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockPushToast = vi.fn()
    mockIsAnyModalOpen = vi.fn(() => false)
    mockQuickMergeSession = vi.fn()
    mockIsMergeInFlight = vi.fn(() => false)
    mockSetFilterMode = vi.fn()

    useModalMock.mockReturnValue({ isAnyModalOpen: mockIsAnyModalOpen })
    useToastMock.mockReturnValue({ pushToast: mockPushToast })
  })

  it('does nothing when modal is open', async () => {
    mockIsAnyModalOpen.mockReturnValue(true)
    const session = createSession('test-session')

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(result)

    expect(mockQuickMergeSession).not.toHaveBeenCalled()
    expect(mockPushToast).not.toHaveBeenCalled()
  })

  it('does nothing when no session is selected', async () => {
    useSelectionMock.mockReturnValue({ selection: { kind: 'orchestrator', payload: null } })
    useSessionsMock.mockReturnValue({
      sessions: [],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(result)

    expect(mockQuickMergeSession).not.toHaveBeenCalled()
  })

  it('does nothing when session not found', async () => {
    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'nonexistent' } })
    useSessionsMock.mockReturnValue({
      sessions: [],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(result)

    expect(mockQuickMergeSession).not.toHaveBeenCalled()
  })

  it('shows toast when merge already in flight', async () => {
    const session = createSession('test-session')
    mockIsMergeInFlight.mockReturnValue(true)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(result)

    expect(mockQuickMergeSession).not.toHaveBeenCalled()
    expect(mockPushToast).toHaveBeenCalledWith({
      tone: 'info',
      title: 'Merge already running',
      description: 'test-session is already merging.',
    })
  })

  it('keeps the current filter by default even when auto-marked ready', async () => {
    const session = createSession('test-session', { ready_to_merge: false })
    const result: ShortcutMergeResult = { status: 'started', autoMarkedReady: true }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(hookResult)

    expect(mockSetFilterMode).not.toHaveBeenCalled()
    expect(mockPushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'info',
        title: 'Session moved to review',
      })
    )
  })

  it('can opt-in to pivoting filters when enableFilterPivot is true', async () => {
    const session = createSession('test-session', { ready_to_merge: false })
    const result: ShortcutMergeResult = { status: 'started', autoMarkedReady: true }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() =>
      useSessionMergeShortcut({ enableFilterPivot: true })
    )

    await runMergeShortcut(hookResult)

    expect(mockSetFilterMode).toHaveBeenCalledWith(FilterMode.All)
  })

  it('defers filter pivot until quick merge resolves when opt-in is enabled', async () => {
    const session = createSession('test-session', { ready_to_merge: false })
    let resolveMerge: (value: ShortcutMergeResult) => void = () => {
      throw new Error('resolveMerge not assigned')
    }
    const pendingMerge = new Promise<ShortcutMergeResult>((resolve) => {
      resolveMerge = resolve
    })
    mockQuickMergeSession.mockReturnValue(pendingMerge)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result } = renderHook(() => useSessionMergeShortcut({ enableFilterPivot: true }))

    const promise = result.current.handleMergeShortcut()
    expect(mockSetFilterMode).not.toHaveBeenCalled()

    resolveMerge({ status: 'started', autoMarkedReady: true })
    await act(async () => {
      await promise
    })

    expect(mockSetFilterMode).toHaveBeenCalledTimes(1)
    expect(mockSetFilterMode).toHaveBeenCalledWith(FilterMode.All)
  })

  it('does not pivot filter when session is already ready', async () => {
    const session = createSession('test-session', { ready_to_merge: true })
    const result: ShortcutMergeResult = { status: 'started' }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(hookResult)

    expect(mockSetFilterMode).not.toHaveBeenCalled()
  })

  it('does not pivot filter when on All filter', async () => {
    const session = createSession('test-session', { ready_to_merge: false })
    const result: ShortcutMergeResult = { status: 'started', autoMarkedReady: true }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.All,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(hookResult)

    expect(mockSetFilterMode).not.toHaveBeenCalled()
  })

  it('handles started status with success toast', async () => {
    const session = createSession('test-session', { ready_to_merge: true })
    const result: ShortcutMergeResult = { status: 'started' }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.All,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(hookResult)

    expect(mockPushToast).toHaveBeenCalledWith({
      tone: 'info',
      title: 'Merging test-session',
      description: 'Fast-forwarding main...',
    })
  })

  it('handles needs-modal status with conflict reason', async () => {
    const session = createSession('test-session', { ready_to_merge: true })
    const result: ShortcutMergeResult = { status: 'needs-modal', reason: 'conflict' }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.All,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(hookResult)

    expect(mockPushToast).toHaveBeenCalledWith({
      tone: 'warning',
      title: 'Conflicts detected',
      description: 'Review conflicts in the merge dialog.',
    })
  })

  it('handles needs-modal status with missing-commit reason', async () => {
    const session = createSession('test-session', { ready_to_merge: true })
    const result: ShortcutMergeResult = { status: 'needs-modal', reason: 'missing-commit' }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.All,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(hookResult)

    expect(mockPushToast).toHaveBeenCalledWith({
      tone: 'info',
      title: 'Commit message required',
      description: 'Review and confirm the merge details.',
    })
  })

  it('handles needs-modal status with confirm reason and auto-marked ready', async () => {
    const session = createSession('test-session', { ready_to_merge: false })
    const result: ShortcutMergeResult = { status: 'needs-modal', reason: 'confirm', autoMarkedReady: true }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.All,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(hookResult)

    expect(mockPushToast).toHaveBeenCalledWith({
      tone: 'info',
      title: 'Session ready to merge',
      description: 'Review the commit message before confirming the merge.',
    })
  })

  it('keeps the current filter when confirm modal opens after auto-mark ready', async () => {
    const session = createSession('test-session', { ready_to_merge: false })
    const result: ShortcutMergeResult = { status: 'needs-modal', reason: 'confirm', autoMarkedReady: true }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(hookResult)

    expect(mockSetFilterMode).not.toHaveBeenCalled()
  })

  it('handles blocked status with already-merged reason', async () => {
    const session = createSession('test-session', { ready_to_merge: true })
    const result: ShortcutMergeResult = { status: 'blocked', reason: 'already-merged' }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.All,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(hookResult)

    expect(mockPushToast).toHaveBeenCalledWith({
      tone: 'info',
      title: 'Nothing to merge',
      description: 'test-session is already up to date.',
    })
  })

  it('leaves filter untouched when blocked without auto-mark', async () => {
    const session = createSession('test-session', { ready_to_merge: false })
    const result: ShortcutMergeResult = { status: 'blocked', reason: 'not-ready' }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(hookResult)

    expect(mockSetFilterMode).not.toHaveBeenCalled()
  })

  it('does not pivot filter when blocked after auto-mark by default', async () => {
    const session = createSession('test-session', { ready_to_merge: false })
    const result: ShortcutMergeResult = { status: 'blocked', reason: 'not-ready', autoMarkedReady: true }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(hookResult)

    expect(mockSetFilterMode).not.toHaveBeenCalled()
  })

  it('handles error status and restores filter', async () => {
    const session = createSession('test-session', { ready_to_merge: false })
    const result: ShortcutMergeResult = { status: 'error', message: 'Something went wrong' }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(hookResult)

    expect(mockPushToast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Merge failed',
      description: 'Something went wrong',
    })
    expect(mockSetFilterMode).not.toHaveBeenCalled()
  })

  it('handles exception and restores filter', async () => {
    const session = createSession('test-session', { ready_to_merge: false })
    mockQuickMergeSession.mockRejectedValue(new Error('Network error'))

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() => useSessionMergeShortcut())

    await runMergeShortcut(hookResult)

    expect(mockPushToast).toHaveBeenCalledWith({
      tone: 'error',
      title: 'Merge failed',
      description: 'Network error',
    })
    expect(mockSetFilterMode).not.toHaveBeenCalled()
  })

  it('uses commit message draft when available', async () => {
    const session = createSession('test-session', { ready_to_merge: true })
    const result: ShortcutMergeResult = { status: 'started' }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.All,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() =>
      useSessionMergeShortcut({
        commitMessageDrafts: { 'test-session': 'Draft commit message' },
      })
    )

    await runMergeShortcut(hookResult)

    expect(mockQuickMergeSession).toHaveBeenCalledWith('test-session', {
      commitMessage: 'Draft commit message',
    })
  })

  it('respects enableFilterPivot option when false', async () => {
    const session = createSession('test-session', { ready_to_merge: false })
    const result: ShortcutMergeResult = { status: 'started', autoMarkedReady: true }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() =>
      useSessionMergeShortcut({
        enableFilterPivot: false,
      })
    )

    await runMergeShortcut(hookResult)

    expect(mockSetFilterMode).not.toHaveBeenCalled()
  })

  it('returns isMerging status correctly', () => {
    const session1 = createSession('session-1')
    const session2 = createSession('session-2')
    mockIsMergeInFlight.mockImplementation((id: string) => id === 'session-1')

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'session-1' } })
    useSessionsMock.mockReturnValue({
      sessions: [session1, session2],
      filterMode: FilterMode.All,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result } = renderHook(() => useSessionMergeShortcut())

    expect(result.current.isMerging).toBe(true)
    expect(result.current.isSessionMerging('session-1')).toBe(true)
    expect(result.current.isSessionMerging('session-2')).toBe(false)
  })

  it('uses custom toast function when provided', async () => {
    const customPushToast = vi.fn()
    const session = createSession('test-session', { ready_to_merge: true })
    const result: ShortcutMergeResult = { status: 'started' }
    mockQuickMergeSession.mockResolvedValue(result)

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.All,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result: hookResult } = renderHook(() =>
      useSessionMergeShortcut({
        pushToast: customPushToast,
      })
    )

    await runMergeShortcut(hookResult)

    expect(customPushToast).toHaveBeenCalled()
    expect(mockPushToast).not.toHaveBeenCalled()
  })

  it('uses custom modal check function when provided', async () => {
    const customIsAnyModalOpen = vi.fn(() => true)
    const session = createSession('test-session')

    useSelectionMock.mockReturnValue({ selection: { kind: 'session', payload: 'test-session' } })
    useSessionsMock.mockReturnValue({
      sessions: [session],
      filterMode: FilterMode.Running,
      setFilterMode: mockSetFilterMode,
      quickMergeSession: mockQuickMergeSession,
      isMergeInFlight: mockIsMergeInFlight,
    })

    const { result } = renderHook(() =>
      useSessionMergeShortcut({
        isAnyModalOpen: customIsAnyModalOpen,
      })
    )

    await runMergeShortcut(result)

    expect(customIsAnyModalOpen).toHaveBeenCalled()
    expect(mockQuickMergeSession).not.toHaveBeenCalled()
  })
})
