import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import type { EnrichedSession } from '../types/session'
import { useUpdateSessionFromParent } from './useUpdateSessionFromParent'
import { TauriCommands } from '../common/tauriCommands'

const useSessionsMock = vi.fn()
const pushToastMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('./useSessions', () => ({
  useSessions: () => useSessionsMock(),
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
      branch: 'schaltwerk/session-one',
      worktree_path: '/tmp/session-one',
      base_branch: 'main',
      parent_branch: 'main',
      status: 'active',
      session_state: 'running',
      ready_to_merge: false,
      is_current: false,
      session_type: 'worktree',
      ...overrides,
    },
    terminals: [],
  }
}

describe('useUpdateSessionFromParent', () => {
  const mockInvoke = vi.mocked(invoke)

  beforeEach(() => {
    vi.clearAllMocks()
    const session = createSession()

    useSessionsMock.mockReturnValue({
      sessions: [session],
    })
  })

  describe('updates all running sessions', () => {
    it('shows warning toast when no running sessions exist', async () => {
      const specSession = createSession({
        session_id: 'spec-1',
        session_state: 'spec',
        status: 'spec',
      })
      useSessionsMock.mockReturnValueOnce({
        sessions: [specSession],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'No running sessions',
        }),
      )
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('shows warning toast when sessions list is empty', async () => {
      useSessionsMock.mockReturnValueOnce({
        sessions: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'No running sessions',
        }),
      )
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('calls invoke for each running session', async () => {
      const session1 = createSession({ session_id: 'session-1', display_name: 'S1' })
      const session2 = createSession({ session_id: 'session-2', display_name: 'S2' })
      useSessionsMock.mockReturnValueOnce({
        sessions: [session1, session2],
      })
      mockInvoke.mockResolvedValue({
        status: 'success',
        parentBranch: 'main',
        message: 'Updated',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(mockInvoke).toHaveBeenCalledTimes(2)
      expect(mockInvoke).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreUpdateSessionFromParent,
        { name: 'session-1' },
      )
      expect(mockInvoke).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreUpdateSessionFromParent,
        { name: 'session-2' },
      )
    })

    it('skips spec sessions', async () => {
      const running = createSession({ session_id: 'running-1' })
      const spec = createSession({ session_id: 'spec-1', session_state: 'spec', status: 'spec' })
      useSessionsMock.mockReturnValueOnce({
        sessions: [running, spec],
      })
      mockInvoke.mockResolvedValue({
        status: 'success',
        parentBranch: 'main',
        message: 'Updated',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(mockInvoke).toHaveBeenCalledTimes(1)
      expect(mockInvoke).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreUpdateSessionFromParent,
        { name: 'running-1' },
      )
    })

    it('includes reviewed sessions', async () => {
      const running = createSession({ session_id: 'running-1' })
      const reviewed = createSession({
        session_id: 'reviewed-1',
        session_state: 'reviewed',
        ready_to_merge: true,
      })
      useSessionsMock.mockReturnValueOnce({
        sessions: [running, reviewed],
      })
      mockInvoke.mockResolvedValue({
        status: 'success',
        parentBranch: 'main',
        message: 'Updated',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(mockInvoke).toHaveBeenCalledTimes(2)
    })

    it('shows success toast when all sessions succeed', async () => {
      const session1 = createSession({ session_id: 's1', display_name: 'S1' })
      const session2 = createSession({ session_id: 's2', display_name: 'S2' })
      useSessionsMock.mockReturnValueOnce({
        sessions: [session1, session2],
      })
      mockInvoke.mockResolvedValue({
        status: 'success',
        parentBranch: 'main',
        message: 'Updated',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'success',
          title: 'All sessions updated',
        }),
      )
    })

    it('shows success toast when all sessions are already up to date', async () => {
      const session1 = createSession({ session_id: 's1' })
      const session2 = createSession({ session_id: 's2' })
      useSessionsMock.mockReturnValueOnce({
        sessions: [session1, session2],
      })
      mockInvoke.mockResolvedValue({
        status: 'already_up_to_date',
        parentBranch: 'main',
        message: 'Already up to date',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'info',
          title: 'All sessions up to date',
        }),
      )
    })

    it('shows mixed results when some sessions fail', async () => {
      const session1 = createSession({ session_id: 's1', display_name: 'S1' })
      const session2 = createSession({ session_id: 's2', display_name: 'S2' })
      useSessionsMock.mockReturnValueOnce({
        sessions: [session1, session2],
      })
      mockInvoke
        .mockResolvedValueOnce({
          status: 'success',
          parentBranch: 'main',
          message: 'Updated',
          conflictingPaths: [],
        })
        .mockResolvedValueOnce({
          status: 'has_conflicts',
          parentBranch: 'main',
          message: 'Conflicts',
          conflictingPaths: ['file.ts'],
        })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'Some sessions had issues',
        }),
      )
    })

    it('handles invoke errors gracefully per session', async () => {
      const session1 = createSession({ session_id: 's1', display_name: 'S1' })
      const session2 = createSession({ session_id: 's2', display_name: 'S2' })
      useSessionsMock.mockReturnValueOnce({
        sessions: [session1, session2],
      })
      mockInvoke
        .mockResolvedValueOnce({
          status: 'success',
          parentBranch: 'main',
          message: 'Updated',
          conflictingPaths: [],
        })
        .mockRejectedValueOnce(new Error('Network error'))

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'Some sessions had issues',
        }),
      )
    })

    it('shows error toast when all sessions fail', async () => {
      const session1 = createSession({ session_id: 's1', display_name: 'S1' })
      const session2 = createSession({ session_id: 's2', display_name: 'S2' })
      useSessionsMock.mockReturnValueOnce({
        sessions: [session1, session2],
      })
      mockInvoke.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'error',
          title: 'Update failed',
        }),
      )
    })
  })

  describe('single session update', () => {
    it('calls invoke with correct command and session name', async () => {
      mockInvoke.mockResolvedValueOnce({
        status: 'success',
        parentBranch: 'main',
        message: 'Session updated from main',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(mockInvoke).toHaveBeenCalledWith(
        TauriCommands.SchaltwerkCoreUpdateSessionFromParent,
        { name: 'session-1' },
      )
    })

    it('shows success toast on successful update', async () => {
      mockInvoke.mockResolvedValueOnce({
        status: 'success',
        parentBranch: 'main',
        message: 'Session updated from main',
        conflictingPaths: [],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('session-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'success',
          title: 'Session updated',
        }),
      )
    })

    it('shows warning toast when session not found', async () => {
      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('nonexistent')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'Session not found',
        }),
      )
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('shows warning toast when session is a spec', async () => {
      const specSession = createSession({
        session_id: 'spec-1',
        session_state: 'spec',
        status: 'spec',
      })
      useSessionsMock.mockReturnValueOnce({
        sessions: [specSession],
      })

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateSessionFromParent('spec-1')
      })

      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: 'warning',
          title: 'Cannot update spec',
        }),
      )
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })

  describe('isUpdating state', () => {
    it('sets isUpdating to true during update', async () => {
      let resolvePromise: (value: unknown) => void
      const pendingPromise = new Promise(resolve => {
        resolvePromise = resolve
      })
      mockInvoke.mockReturnValue(pendingPromise)

      const { result } = renderHook(() => useUpdateSessionFromParent())

      expect(result.current.isUpdating).toBe(false)

      let updatePromise: Promise<void>
      act(() => {
        updatePromise = result.current.updateAllSessionsFromParent()
      })

      expect(result.current.isUpdating).toBe(true)

      await act(async () => {
        resolvePromise!({
          status: 'success',
          parentBranch: 'main',
          message: 'Done',
          conflictingPaths: [],
        })
        await updatePromise
      })

      expect(result.current.isUpdating).toBe(false)
    })

    it('resets isUpdating to false even on error', async () => {
      mockInvoke.mockRejectedValue(new Error('Failed'))

      const { result } = renderHook(() => useUpdateSessionFromParent())

      await act(async () => {
        await result.current.updateAllSessionsFromParent()
      })

      expect(result.current.isUpdating).toBe(false)
    })
  })
})
