import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionPrefill, extractSessionContent } from './useSessionPrefill'

// Mock the Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'

describe('useSessionPrefill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractSessionContent', () => {
    it('returns empty string for null sessionData', () => {
      expect(extractSessionContent(null)).toBe('')
    })

    it('returns draft_content when available', () => {
      const sessionData = {
        draft_content: 'Draft content',
        initial_prompt: 'Initial prompt',
      }
      expect(extractSessionContent(sessionData)).toBe('Draft content')
    })

    it('returns initial_prompt when draft_content is null', () => {
      const sessionData = {
        draft_content: null,
        initial_prompt: 'Initial prompt',
      }
      expect(extractSessionContent(sessionData)).toBe('Initial prompt')
    })

    it('returns empty string when both are null', () => {
      const sessionData = {
        draft_content: null,
        initial_prompt: null,
      }
      expect(extractSessionContent(sessionData)).toBe('')
    })

    it('prioritizes draft_content over initial_prompt', () => {
      const sessionData = {
        draft_content: 'Draft',
        initial_prompt: 'Prompt',
      }
      expect(extractSessionContent(sessionData)).toBe('Draft')
    })
  })

  describe('fetchSessionForPrefill', () => {
    it('fetches and transforms session data successfully', async () => {
      const mockSessionData = {
        draft_content: '# Plan Content',
        initial_prompt: 'Initial prompt',
        parent_branch: 'main',
      }

      vi.mocked(invoke).mockResolvedValue(mockSessionData)

      const { result } = renderHook(() => useSessionPrefill())

      let prefillData
      await act(async () => {
        prefillData = await result.current.fetchSessionForPrefill('test-session')
      })

      expect(prefillData).toEqual({
        name: 'test-session',
        taskContent: '# Plan Content',
        baseBranch: 'main',
        lockName: true,
        fromDraft: true,
      })

      expect(invoke).toHaveBeenCalledWith('schaltwerk_core_get_session', { name: 'test-session' })
      expect(result.current.error).toBeNull()
      expect(result.current.isLoading).toBe(false)
    })

    it('uses initial_prompt when draft_content is null', async () => {
      const mockSessionData = {
        draft_content: null,
        initial_prompt: 'Initial prompt content',
        parent_branch: 'develop',
      }

      vi.mocked(invoke).mockResolvedValue(mockSessionData)

      const { result } = renderHook(() => useSessionPrefill())

      let prefillData: any
      await act(async () => {
        prefillData = await result.current.fetchSessionForPrefill('test-session')
      })

      expect(prefillData?.taskContent).toBe('Initial prompt content')
      expect(prefillData?.baseBranch).toBe('develop')
    })

    it('handles missing parent_branch', async () => {
      const mockSessionData = {
        draft_content: 'Content',
        initial_prompt: null,
        parent_branch: null,
      }

      vi.mocked(invoke).mockResolvedValue(mockSessionData)

      const { result } = renderHook(() => useSessionPrefill())

      let prefillData: any
      await act(async () => {
        prefillData = await result.current.fetchSessionForPrefill('test-session')
      })

      expect(prefillData?.baseBranch).toBeUndefined()
    })

    it('handles fetch errors gracefully', async () => {
      const error = new Error('Failed to fetch session')
      vi.mocked(invoke).mockRejectedValue(error)

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderHook(() => useSessionPrefill())

      let prefillData
      await act(async () => {
        prefillData = await result.current.fetchSessionForPrefill('test-session')
      })

      expect(prefillData).toBeNull()
      expect(result.current.error).toBe('Failed to fetch session')
      expect(result.current.isLoading).toBe(false)
      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch session for prefill:', 'Failed to fetch session')

      consoleSpy.mockRestore()
    })

    it('sets loading state during fetch', async () => {
      let resolvePromise: (value: any) => void
      const promise = new Promise((resolve) => {
        resolvePromise = resolve
      })

      vi.mocked(invoke).mockReturnValue(promise)

      const { result } = renderHook(() => useSessionPrefill())

      // Start the fetch
      let fetchPromise: Promise<any>
      act(() => {
        fetchPromise = result.current.fetchSessionForPrefill('test-session')
      })

      // Check loading state is true
      expect(result.current.isLoading).toBe(true)

      // Resolve the promise
      await act(async () => {
        resolvePromise!({
          draft_content: 'Content',
          initial_prompt: null,
          parent_branch: 'main',
        })
        await fetchPromise
      })

      // Loading should be false after completion
      expect(result.current.isLoading).toBe(false)
    })
  })
})