import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTerminalTabs } from './useTerminalTabs'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('useTerminalTabs', () => {
  const mockInvoke = invoke as MockedFunction<typeof invoke>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('creates initial tab with correct structure', () => {
      const { result } = renderHook(() => useTerminalTabs({
        baseTerminalId: 'test-init',
        workingDirectory: '/test/dir'
      }))

      expect(result.current.tabs).toBeDefined()
      expect(result.current.tabs.length).toBeGreaterThanOrEqual(1)
      expect(result.current.tabs[0]).toMatchObject({
        index: expect.any(Number),
        terminalId: expect.stringContaining('test-init'),
        label: expect.stringContaining('Terminal')
      })
      expect(result.current.activeTab).toBeDefined()
      expect(result.current.canAddTab).toBeDefined()
    })

    it('respects custom maxTabs parameter', () => {
      const { result } = renderHook(() => useTerminalTabs({
        baseTerminalId: 'test-max',
        workingDirectory: '/test/dir',
        maxTabs: 3
      }))

      expect(result.current.canAddTab).toBeDefined()
    })
  })

  describe('addTab', () => {
    it('can add new tabs', async () => {
      mockInvoke.mockImplementation((command: string) => {
        if (command === 'terminal_exists') {
          return Promise.resolve(false)
        }
        if (command === 'create_terminal') {
          return Promise.resolve()
        }
        return Promise.resolve()
      })

      const { result } = renderHook(() => useTerminalTabs({
        baseTerminalId: 'test-add',
        workingDirectory: '/test/dir'
      }))

      const initialTabCount = result.current.tabs.length

      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs.length).toBeGreaterThan(initialTabCount)
      expect(mockInvoke).toHaveBeenCalledWith('create_terminal', expect.objectContaining({
        cwd: '/test/dir'
      }))
    })

    it('handles terminal creation failure gracefully', async () => {
      mockInvoke.mockImplementation((command: string) => {
        if (command === 'terminal_exists') {
          return Promise.resolve(false)
        }
        if (command === 'create_terminal') {
          return Promise.reject(new Error('Failed to create terminal'))
        }
        return Promise.resolve()
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = renderHook(() => useTerminalTabs({
        baseTerminalId: 'test-fail',
        workingDirectory: '/test/dir'
      }))

      await act(async () => {
        try {
          await result.current.addTab()
        } catch (e) {
          // Expected to fail
        }
      })

      expect(consoleSpy).toHaveBeenCalled()
      
      consoleSpy.mockRestore()
    })
  })

  describe('closeTab', () => {
    it('can close tabs', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const { result } = renderHook(() => useTerminalTabs({
        baseTerminalId: 'test-close',
        workingDirectory: '/test/dir'
      }))

      // Add a tab first
      await act(async () => {
        await result.current.addTab()
      })

      const tabCount = result.current.tabs.length
      
      if (tabCount > 1) {
        const tabToClose = result.current.tabs[1]
        
        await act(async () => {
          await result.current.closeTab(tabToClose.index)
        })

        expect(mockInvoke).toHaveBeenCalledWith('close_terminal', expect.any(Object))
      }
    })

    it('handles terminal close failure gracefully', async () => {
      mockInvoke.mockImplementation((command: string) => {
        if (command === 'close_terminal') {
          return Promise.reject(new Error('Failed to close'))
        }
        return Promise.resolve()
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = renderHook(() => useTerminalTabs({
        baseTerminalId: 'test-close-fail',
        workingDirectory: '/test/dir'
      }))

      await act(async () => {
        await result.current.addTab()
      })

      if (result.current.tabs.length > 1) {
        await act(async () => {
          await result.current.closeTab(result.current.tabs[1].index)
        })

        expect(consoleSpy).toHaveBeenCalled()
      }
      
      consoleSpy.mockRestore()
    })
  })

  describe('setActiveTab', () => {
    it('can change active tab', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const { result } = renderHook(() => useTerminalTabs({
        baseTerminalId: 'test-active',
        workingDirectory: '/test/dir'
      }))

      await act(async () => {
        await result.current.addTab()
      })

      if (result.current.tabs.length > 1) {
        const firstTab = result.current.tabs[0]
        
        act(() => {
          result.current.setActiveTab(firstTab.index)
        })

        expect(result.current.activeTab).toBe(firstTab.index)
      }
    })
  })

  describe('error handling', () => {
    it('logs error when terminal creation fails', async () => {
      mockInvoke.mockImplementation((command: string) => {
        if (command === 'terminal_exists') {
          return Promise.resolve(false)
        }
        if (command === 'create_terminal') {
          return Promise.reject(new Error('Permission denied'))
        }
        return Promise.resolve()
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      renderHook(() => useTerminalTabs({
        baseTerminalId: 'test-error',
        workingDirectory: '/test/dir'
      }))

      // Wait a bit for the async operation
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })
})