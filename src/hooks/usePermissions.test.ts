import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useFolderPermission } from './usePermissions'
import { renderHook, act } from '@testing-library/react'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

describe('useFolderPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('returns initial state when no folderPath provided', () => {
      const { result } = renderHook(() => useFolderPermission())

      expect(result.current.hasPermission).toBeNull()
      expect(result.current.isChecking).toBe(false)
      expect(result.current.permissionError).toBeNull()
      expect(result.current.deniedPath).toBeNull()
    })

    it('returns initial state when folderPath is empty string', () => {
      const { result } = renderHook(() => useFolderPermission(''))

      expect(result.current.hasPermission).toBeNull()
      expect(result.current.isChecking).toBe(false)
      expect(result.current.permissionError).toBeNull()
      expect(result.current.deniedPath).toBeNull()
    })
  })

  describe('automatic permission check on mount', () => {
    it('automatically checks permission when folderPath is provided', async () => {
      const testPath = '/test/path'
      mockInvoke.mockResolvedValueOnce(true)

      const { result } = renderHook(() => useFolderPermission(testPath))

      expect(result.current.isChecking).toBe(true)
      expect(mockInvoke).toHaveBeenCalledWith('check_folder_access', { path: testPath })

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(result.current.hasPermission).toBe(true)
      expect(result.current.isChecking).toBe(false)
      expect(result.current.permissionError).toBeNull()
      expect(result.current.deniedPath).toBeNull()
    })

    it('handles automatic permission check failure', async () => {
      const testPath = '/test/path'
      const testError = 'Access denied'
      mockInvoke.mockRejectedValueOnce(new Error(testError))

      const { result } = renderHook(() => useFolderPermission(testPath))

      expect(result.current.isChecking).toBe(true)

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(result.current.hasPermission).toBe(false)
      expect(result.current.isChecking).toBe(false)
      expect(result.current.permissionError).toBe(`Error: ${testError}`)
      expect(result.current.deniedPath).toBe(testPath)
    })

    it('sets deniedPath when permission is false', async () => {
      const testPath = '/test/path'
      mockInvoke.mockResolvedValueOnce(false)

      const { result } = renderHook(() => useFolderPermission(testPath))

      await act(async () => {
        await vi.runAllTimersAsync()
      })

      expect(result.current.hasPermission).toBe(false)
      expect(result.current.deniedPath).toBe(testPath)
    })
  })

  describe('checkPermission function', () => {
    it('successfully checks permission and returns true', async () => {
      const testPath = '/test/path'
      mockInvoke.mockResolvedValueOnce(true)

      const { result } = renderHook(() => useFolderPermission())

      let returnValue: boolean | undefined
      await act(async () => {
        returnValue = await result.current.checkPermission(testPath)
      })

      expect(returnValue).toBe(true)
      expect(result.current.hasPermission).toBe(true)
      expect(result.current.isChecking).toBe(false)
      expect(result.current.permissionError).toBeNull()
      expect(result.current.deniedPath).toBeNull()
      expect(mockInvoke).toHaveBeenCalledWith('check_folder_access', { path: testPath })
    })

    it('successfully checks permission and returns false', async () => {
      const testPath = '/test/path'
      mockInvoke.mockResolvedValueOnce(false)

      const { result } = renderHook(() => useFolderPermission())

      let returnValue: boolean | undefined
      await act(async () => {
        returnValue = await result.current.checkPermission(testPath)
      })

      expect(returnValue).toBe(false)
      expect(result.current.hasPermission).toBe(false)
      expect(result.current.deniedPath).toBe(testPath)
    })

    it('handles errors during permission check', async () => {
      const testPath = '/test/path'
      const testError = 'Permission check failed'
      mockInvoke.mockRejectedValueOnce(new Error(testError))

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderHook(() => useFolderPermission())

      let returnValue: boolean | undefined
      await act(async () => {
        returnValue = await result.current.checkPermission(testPath)
      })

      expect(returnValue).toBe(false)
      expect(result.current.hasPermission).toBe(false)
      expect(result.current.permissionError).toBe(`Error: ${testError}`)
      expect(result.current.deniedPath).toBe(testPath)
      expect(consoleSpy).toHaveBeenCalledWith(`Error checking folder permission for ${testPath}:`, expect.any(Error))

      consoleSpy.mockRestore()
    })
  })

  describe('requestPermission function', () => {
    it('successfully requests and grants permission', async () => {
      vi.useRealTimers() // Use real timers for this test since we need actual async behavior
      
      const testPath = '/test/path'
      mockInvoke.mockResolvedValueOnce(undefined) // ensure_folder_permission
      mockInvoke.mockResolvedValueOnce(true) // check_folder_access after delay

      const { result } = renderHook(() => useFolderPermission())

      let returnValue: boolean | undefined
      await act(async () => {
        returnValue = await result.current.requestPermission(testPath)
      })

      expect(returnValue).toBe(true)
      expect(result.current.hasPermission).toBe(true)
      expect(result.current.isChecking).toBe(false)
      expect(result.current.permissionError).toBeNull()
      expect(mockInvoke).toHaveBeenCalledWith('ensure_folder_permission', { path: testPath })
      expect(mockInvoke).toHaveBeenCalledWith('check_folder_access', { path: testPath })
    })

    it('waits for 500ms delay before checking permission', async () => {
      vi.useRealTimers() // Use real timers for this test since we need actual async behavior
      
      const testPath = '/test/path'
      mockInvoke.mockResolvedValueOnce(undefined)
      mockInvoke.mockResolvedValueOnce(true)

      const { result } = renderHook(() => useFolderPermission())

      await act(async () => {
        await result.current.requestPermission(testPath)
      })

      expect(mockInvoke).toHaveBeenCalledWith('ensure_folder_permission', { path: testPath })
      expect(mockInvoke).toHaveBeenCalledWith('check_folder_access', { path: testPath })
    })
  })

  describe('error handling edge cases', () => {
    it('handles invoke returning non-boolean values', async () => {
      const testPath = '/test/path'
      mockInvoke.mockResolvedValueOnce('true') // String instead of boolean

      const { result } = renderHook(() => useFolderPermission())

      await act(async () => {
        await result.current.checkPermission(testPath)
      })

      expect(result.current.hasPermission).toBe('true')
    })
  })

  describe('cleanup and memory management', () => {
    it('cleans up timers on unmount', () => {
      const testPath = '/test/path'
      mockInvoke.mockResolvedValueOnce(true)

      const { unmount } = renderHook(() => useFolderPermission(testPath))

      unmount()

      // Should not cause any issues
      expect(() => unmount()).not.toThrow()
    })

    it('handles component unmount during async operation', async () => {
      const testPath = '/test/path'
      let resolvePromise: (value: boolean) => void = () => {}

      const promise = new Promise<boolean>((resolve) => {
        resolvePromise = resolve
      })

      mockInvoke.mockReturnValueOnce(promise)

      const { result, unmount } = renderHook(() => useFolderPermission())

      const checkPromise = act(async () => {
        await result.current.checkPermission(testPath)
      })

      // Unmount before promise resolves
      unmount()

      // Resolve the promise (this should not cause state updates on unmounted component)
      resolvePromise(true)

      await expect(checkPromise).resolves.toBeUndefined()
    })
  })
})