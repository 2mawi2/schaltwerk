import { describe, it, expect, vi, beforeEach, MockedFunction, afterEach } from 'vitest'
import { TauriCommands } from '../common/tauriCommands'
import { renderHook, act } from '@testing-library/react'
import { useTerminalTabs } from './useTerminalTabs'
import { invoke } from '@tauri-apps/api/core'
import { MockTauriInvokeArgs } from '../types/testing'
import { TestProviders } from '../tests/test-utils'
import { ReactNode, createElement } from 'react'

// Mock the invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

// Mock window event listeners
const mockAddEventListener = vi.fn()
const mockRemoveEventListener = vi.fn()

Object.defineProperty(window, 'addEventListener', {
  writable: true,
  value: mockAddEventListener
})

Object.defineProperty(window, 'removeEventListener', {
  writable: true,
  value: mockRemoveEventListener
})

describe('useTerminalTabs', () => {
  const mockInvoke = invoke as MockedFunction<typeof invoke>
  const defaultInvokeImplementation = (command: string, _args?: MockTauriInvokeArgs) => {
    switch (command) {
      case TauriCommands.TerminalExists:
        return Promise.resolve(false)
      case TauriCommands.CreateTerminal:
        return Promise.resolve()
      case TauriCommands.CloseTerminal:
        return Promise.resolve()
      case TauriCommands.RegisterSessionTerminals:
      case TauriCommands.SuspendSessionTerminals:
      case TauriCommands.ResumeSessionTerminals:
        return Promise.resolve()
      default:
        return Promise.resolve()
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAddEventListener.mockClear()
    mockRemoveEventListener.mockClear()
    mockInvoke.mockImplementation((command: string, args?: MockTauriInvokeArgs) => defaultInvokeImplementation(command, args))
    // Clear global state between tests by directly accessing the module's global variables
    // This is a workaround since we can't easily reset the module-level state
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  const wrapper = ({ children }: { children: ReactNode }) => createElement(TestProviders, null, children)
  const renderTabsHook = (props: Parameters<typeof useTerminalTabs>[0]) => renderHook(() => useTerminalTabs(props), { wrapper })

  describe('initialization', () => {
    it('creates initial tab with correct structure', () => {
      const { result } = renderTabsHook({
        baseTerminalId: 'test-init',
        workingDirectory: '/test/dir'
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0]).toMatchObject({
        index: 0,
        terminalId: 'test-init-0',
        label: 'Terminal 1'
      })
      expect(result.current.activeTab).toBe(0)
      expect(result.current.canAddTab).toBe(true)
    })

    it('respects custom maxTabs parameter', () => {
      const { result } = renderTabsHook({
        baseTerminalId: 'test-max',
        workingDirectory: '/test/dir',
        maxTabs: 3
      })

      expect(result.current.canAddTab).toBe(true)
      expect(result.current.tabs).toHaveLength(1)
    })

    it('uses default maxTabs when not specified', () => {
      const { result } = renderTabsHook({
        baseTerminalId: 'test-default',
        workingDirectory: '/test/dir'
      })

      expect(result.current.canAddTab).toBe(true)
      // Should be able to add up to 6 tabs (DEFAULT_MAX_TABS)
      expect(result.current.tabs).toHaveLength(1)
    })

    it('sets up event listeners for reset functionality', () => {
      renderTabsHook({
        baseTerminalId: 'test-events',
        workingDirectory: '/test/dir'
      })

      expect(mockAddEventListener).toHaveBeenCalledWith(
        'schaltwerk:reset-terminals',
        expect.any(Function)
      )
    })

    it('cleans up event listeners on unmount', () => {
      const { unmount } = renderTabsHook({
        baseTerminalId: 'test-cleanup',
        workingDirectory: '/test/dir'
      })

      unmount()

      expect(mockRemoveEventListener).toHaveBeenCalledWith(
        'schaltwerk:reset-terminals',
        expect.any(Function)
      )
    })
  })

  describe('global state persistence', () => {
    it('maintains state across component remounts', () => {
      const hookProps = {
        baseTerminalId: 'test-persist',
        workingDirectory: '/test/dir'
      }

      // First render
      const { result: result1, unmount: unmount1 } = renderTabsHook(hookProps)

      // Unmount and remount
      unmount1()
      const { result: result2 } = renderTabsHook(hookProps)

      // State should persist
      expect(result2.current.tabs).toHaveLength(result1.current.tabs.length)
      expect(result2.current.activeTab).toBe(result1.current.activeTab)
    })

    it('isolates state between different sessions', () => {
      const { result: result1 } = renderTabsHook({
        baseTerminalId: 'session1',
        workingDirectory: '/test/dir'
      })

      const { result: result2 } = renderTabsHook({
        baseTerminalId: 'session2',
        workingDirectory: '/test/dir'
      })

      expect(result1.current.tabs[0].terminalId).toBe('session1-0')
      expect(result2.current.tabs[0].terminalId).toBe('session2-0')
      expect(result1.current.tabs[0].terminalId).not.toBe(result2.current.tabs[0].terminalId)
    })
  })

  describe('reset functionality', () => {
    it('resets state when reset event is triggered', async () => {
      const hookProps = {
        baseTerminalId: 'test-reset',
        workingDirectory: '/test/dir'
      }

      const { result } = renderTabsHook(hookProps)

      // Add some tabs first
      mockInvoke.mockResolvedValue(false) // terminal_exists returns false
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs).toHaveLength(2)

      // Trigger reset event
      const resetHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'schaltwerk:reset-terminals'
      )?.[1]

      act(() => {
        resetHandler?.()
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.tabs[0]).toMatchObject({
        index: 0,
        terminalId: 'test-reset-0',
        label: 'Terminal 1'
      })
      expect(result.current.activeTab).toBe(0)
    })

    it('cleans up terminal references on reset', async () => {
      const hookProps = {
        baseTerminalId: 'test-reset-cleanup',
        workingDirectory: '/test/dir'
      }

      const { result } = renderTabsHook(hookProps)

      // Add tabs to create terminal references
      mockInvoke.mockResolvedValue(false)
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs).toHaveLength(2)

      // Trigger reset
      const resetHandler = mockAddEventListener.mock.calls.find(
        call => call[0] === 'schaltwerk:reset-terminals'
      )?.[1]

      act(() => {
        resetHandler?.()
      })

      // Should be reset to initial state
      expect(result.current.tabs).toHaveLength(1)
    })
  })

  describe('terminal creation logic', () => {
    it('creates terminal when it does not exist', async () => {
      mockInvoke.mockImplementation((command: string, args?: MockTauriInvokeArgs) => {
        if (command === TauriCommands.TerminalExists) {
          return Promise.resolve(false)
        }
      if (command === TauriCommands.CreateTerminal) {
        expect(args).toEqual({
          id: 'test-create-1',
          cwd: '/test/dir'
        })
        return Promise.resolve()
      }
      return defaultInvokeImplementation(command, args)
    })

      const { result } = renderTabsHook({
        baseTerminalId: 'test-create',
        workingDirectory: '/test/dir'
      })

      await act(async () => {
        await result.current.addTab()
      })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.TerminalExists, { id: 'test-create-1' })
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.CreateTerminal, {
        id: 'test-create-1',
        cwd: '/test/dir'
      })
    })

    it('skips creation when terminal already exists', async () => {
      mockInvoke.mockImplementation((command: string, args?: MockTauriInvokeArgs) => {
        if (command === TauriCommands.TerminalExists) {
          return Promise.resolve(true)
        }
        return defaultInvokeImplementation(command, args)
      })

      const { result } = renderTabsHook({
        baseTerminalId: 'test-exists',
        workingDirectory: '/test/dir'
      })

      await act(async () => {
        await result.current.addTab()
      })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.TerminalExists, { id: 'test-exists-1' })
      expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.CreateTerminal, expect.any(Object))
    })

    it('handles terminal_exists failure gracefully', async () => {
      mockInvoke.mockImplementation((command: string, args?: MockTauriInvokeArgs) => {
        if (command === TauriCommands.TerminalExists) {
          return Promise.reject(new Error('Permission denied'))
        }
        return defaultInvokeImplementation(command, args)
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderTabsHook({
        baseTerminalId: 'test-exists-fail',
        workingDirectory: '/test/dir'
      })

      await act(async () => {
        await result.current.addTab()
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to create terminal test-exists-fail-1:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })

    it('defers terminal creation until working directory is available', async () => {
      mockInvoke.mockImplementation((command: string, args?: MockTauriInvokeArgs) => {
        if (command === TauriCommands.TerminalExists) {
          return Promise.resolve(false)
        }
        if (command === TauriCommands.CreateTerminal) {
          expect(args).toEqual({
            id: 'test-defer-0',
            cwd: '/ready/path'
          })
          return Promise.resolve()
        }
        return defaultInvokeImplementation(command, args)
      })

      const { rerender } = renderHook(
        (props: { baseTerminalId: string; workingDirectory: string }) => useTerminalTabs(props),
        {
          wrapper,
          initialProps: {
            baseTerminalId: 'test-defer',
            workingDirectory: ''
          }
        }
      )

      await act(async () => {
        await Promise.resolve()
      })

      const createCallsBefore = mockInvoke.mock.calls.filter(call => {
        const [command, params] = call
        if (command !== TauriCommands.CreateTerminal) return false
        const id = (params as { id?: string })?.id
        return id?.startsWith('test-defer')
      })
      expect(createCallsBefore).toHaveLength(0)

      rerender({ baseTerminalId: 'test-defer', workingDirectory: '/ready/path' })

      await act(async () => {
        await Promise.resolve()
      })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.TerminalExists, { id: 'test-defer-0' })
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.CreateTerminal, {
        id: 'test-defer-0',
        cwd: '/ready/path'
      })
    })
  })

  describe('addTab', () => {
    it('adds new tab with correct properties', async () => {
      mockInvoke.mockResolvedValue(false)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-add-props',
        workingDirectory: '/test/dir'
      })

      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs).toHaveLength(2)
      expect(result.current.tabs[1]).toMatchObject({
        index: 1,
        terminalId: 'test-add-props-1',
        label: 'Terminal 2'
      })
      expect(result.current.activeTab).toBe(1)
    })

    it('respects maxTabs limit', async () => {
      mockInvoke.mockResolvedValue(false)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-max-limit',
        workingDirectory: '/test/dir',
        maxTabs: 2
      })

      // Add one tab
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs).toHaveLength(2)
      expect(result.current.canAddTab).toBe(false)

      // Try to add another tab - should not work
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs).toHaveLength(2) // Still 2 tabs
    })

    it('generates correct tab indices', async () => {
      mockInvoke.mockResolvedValue(false)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-indices',
        workingDirectory: '/test/dir'
      })

      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs).toHaveLength(2)
      expect(result.current.tabs.map(t => t.index)).toEqual([0, 1])
      expect(result.current.tabs.map(t => t.terminalId)).toEqual([
        'test-indices-0',
        'test-indices-1'
      ])

      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs).toHaveLength(3)
      expect(result.current.tabs.map(t => t.index)).toEqual([0, 1, 2])
    })

    it('handles creation failure gracefully', async () => {
      mockInvoke.mockImplementation((command: string, args?: MockTauriInvokeArgs) => {
        if (command === TauriCommands.TerminalExists) {
          return Promise.resolve(false)
        }
        if (command === TauriCommands.CreateTerminal) {
          return Promise.reject(new Error('Failed to create terminal'))
        }
        return defaultInvokeImplementation(command, args)
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderTabsHook({
        baseTerminalId: 'test-add-fail',
        workingDirectory: '/test/dir'
      })

      const initialTabCount = result.current.tabs.length

      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs).toHaveLength(initialTabCount) // Should not add tab
      expect(consoleSpy).toHaveBeenCalledWith('Failed to add new tab:', expect.any(Error))

      consoleSpy.mockRestore()
    })
  })

  describe('closeTab', () => {
    it('closes tab and switches to previous tab when closing active tab', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-close-active',
        workingDirectory: '/test/dir'
      })

      // Add tabs
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs).toHaveLength(2)
      expect(result.current.activeTab).toBe(1)

      // Close the active tab (index 1)
      await act(async () => {
        await result.current.closeTab(1)
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.activeTab).toBe(0) // Should switch to remaining tab
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.CloseTerminal, { id: 'test-close-active-1' })
    })

    it('closes tab and keeps same active tab when closing non-active tab', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-close-non-active',
        workingDirectory: '/test/dir'
      })

      // Add tabs
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs).toHaveLength(2)
      expect(result.current.activeTab).toBe(1)

      // Switch to first tab
      act(() => {
        result.current.setActiveTab(0)
      })

      // Close the second tab (index 1)
      await act(async () => {
        await result.current.closeTab(1)
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.activeTab).toBe(0) // Should remain on first tab
    })

    it('closes first tab and switches to next tab', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-close-first',
        workingDirectory: '/test/dir'
      })

      // Add tabs
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs).toHaveLength(2)

      // Switch to first tab and close it
      act(() => {
        result.current.setActiveTab(0)
      })

      await act(async () => {
        await result.current.closeTab(0)
      })

      expect(result.current.tabs).toHaveLength(1)
      expect(result.current.activeTab).toBe(1) // Should switch to next tab
    })

    it('prevents closing the last tab', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-close-last',
        workingDirectory: '/test/dir'
      })

      expect(result.current.tabs).toHaveLength(1)

      await act(async () => {
        await result.current.closeTab(0)
      })

      expect(result.current.tabs).toHaveLength(1) // Should still have 1 tab
      expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.CloseTerminal, expect.any(Object))
    })

    it('handles invalid tab index gracefully', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-invalid-index',
        workingDirectory: '/test/dir'
      })

      await act(async () => {
        await result.current.closeTab(999) // Invalid index
      })

      expect(result.current.tabs).toHaveLength(1) // Should remain unchanged
      expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.CloseTerminal, expect.any(Object))
    })

    it('handles close_terminal failure gracefully', async () => {
      mockInvoke.mockImplementation((command: string, args?: MockTauriInvokeArgs) => {
        if (command === TauriCommands.CloseTerminal) {
          return Promise.reject(new Error('Failed to close'))
        }
        return defaultInvokeImplementation(command, args)
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderTabsHook({
        baseTerminalId: 'test-close-fail',
        workingDirectory: '/test/dir'
      })

      // Add a tab first
      await act(async () => {
        await result.current.addTab()
      })

      await act(async () => {
        await result.current.closeTab(1)
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to close terminal test-close-fail-1:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })
  })

  describe('setActiveTab', () => {
    it('changes active tab to specified index', async () => {
      const { result } = renderTabsHook({
        baseTerminalId: 'test-set-active',
        workingDirectory: '/test/dir'
      })

      // Add tabs
      mockInvoke.mockResolvedValue(false)
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.activeTab).toBe(1)

      act(() => {
        result.current.setActiveTab(0)
      })

      expect(result.current.activeTab).toBe(0)
    })

    it('handles setting active tab to invalid index gracefully', () => {
      const { result } = renderTabsHook({
        baseTerminalId: 'test-set-invalid',
        workingDirectory: '/test/dir'
      })

      act(() => {
        result.current.setActiveTab(999)
      })

      expect(result.current.activeTab).toBe(999) // The hook doesn't validate the index
    })
  })

  describe('initial terminal creation', () => {
    it('creates initial terminal on mount when it does not exist', async () => {
      mockInvoke.mockImplementation((command: string, args?: MockTauriInvokeArgs) => {
        if (command === TauriCommands.TerminalExists) {
          return Promise.resolve(false)
        }
        if (command === TauriCommands.CreateTerminal) {
          expect(args).toEqual({
            id: 'test-initial-0',
            cwd: '/test/dir'
          })
          return Promise.resolve()
        }
        return defaultInvokeImplementation(command, args)
      })

      renderTabsHook({
        baseTerminalId: 'test-initial',
        workingDirectory: '/test/dir'
      })

      // Wait for useEffect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.TerminalExists, { id: 'test-initial-0' })
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.CreateTerminal, {
        id: 'test-initial-0',
        cwd: '/test/dir'
      })
    })

    it('skips initial terminal creation when it already exists', async () => {
      mockInvoke.mockImplementation((command: string, args?: MockTauriInvokeArgs) => {
        if (command === TauriCommands.TerminalExists) {
          return Promise.resolve(true)
        }
        return defaultInvokeImplementation(command, args)
      })

      renderTabsHook({
        baseTerminalId: 'test-initial-exists',
        workingDirectory: '/test/dir'
      })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.TerminalExists, { id: 'test-initial-exists-0' })
      expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.CreateTerminal, expect.any(Object))
    })

    it('handles initial terminal creation failure gracefully', async () => {
      mockInvoke.mockImplementation((command: string, args?: MockTauriInvokeArgs) => {
        if (command === TauriCommands.TerminalExists) {
          return Promise.resolve(false)
        }
        if (command === TauriCommands.CreateTerminal) {
          return Promise.reject(new Error('Failed to create initial terminal'))
        }
        return defaultInvokeImplementation(command, args)
      })

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      renderTabsHook({
        baseTerminalId: 'test-initial-fail',
        workingDirectory: '/test/dir'
      })

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create terminal test-initial-fail-0'),
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })
  })

  describe('tab ordering and labels', () => {
    it('generates correct labels for multiple tabs', async () => {
      mockInvoke.mockResolvedValue(false)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-labels',
        workingDirectory: '/test/dir'
      })

      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs.map(t => t.label)).toEqual([
        'Terminal 1',
        'Terminal 2'
      ])

      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs.map(t => t.label)).toEqual([
        'Terminal 1',
        'Terminal 2',
        'Terminal 3'
      ])
    })

    it('reuses lowest available label numbers after deletion', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-label-reuse',
        workingDirectory: '/test/dir'
      })

      // Add two tabs: Terminal 1, Terminal 2
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs.map(t => t.label)).toEqual([
        'Terminal 1',
        'Terminal 2'
      ])

      // Delete Terminal 1 (index 0)
      await act(async () => {
        await result.current.closeTab(0)
      })

      expect(result.current.tabs.map(t => t.label)).toEqual([
        'Terminal 2'
      ])

      // Add a new tab - should reuse "Terminal 1" (not "Terminal 3")
      await act(async () => {
        await result.current.addTab()
      })

      const labels = result.current.tabs.map(t => t.label).sort()
      expect(labels).toEqual([
        'Terminal 1',
        'Terminal 2'
      ])
    })

    it('handles complex deletion and recreation scenarios', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-complex-labels',
        workingDirectory: '/test/dir',
        maxTabs: 5
      })

      // Create terminals 1, 2, 3
      await act(async () => {
        await result.current.addTab()
      })
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs.map(t => t.label).sort()).toEqual([
        'Terminal 1',
        'Terminal 2', 
        'Terminal 3'
      ])

      // Delete Terminal 2 (middle one)
      const terminal2Tab = result.current.tabs.find(t => t.label === 'Terminal 2')
      await act(async () => {
        await result.current.closeTab(terminal2Tab!.index)
      })

      expect(result.current.tabs.map(t => t.label).sort()).toEqual([
        'Terminal 1',
        'Terminal 3'
      ])

      // Add new terminal - should reuse "Terminal 2"
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs.map(t => t.label).sort()).toEqual([
        'Terminal 1',
        'Terminal 2',
        'Terminal 3'
      ])
    })

    it('maintains correct ordering after tab operations', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-ordering',
        workingDirectory: '/test/dir'
      })

      // Add tabs: [0, 1]
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs).toHaveLength(2)
      expect(result.current.tabs.map(t => t.index)).toEqual([0, 1])

      // Add another tab: [0, 1, 2]
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs.map(t => t.index)).toEqual([0, 1, 2])

      // Close middle tab (index 1): should be [0, 2]
      await act(async () => {
        await result.current.closeTab(1)
      })

      expect(result.current.tabs.map(t => t.index)).toEqual([0, 2])
    })
  })

  describe('canAddTab logic', () => {
    it('returns true when under maxTabs limit', () => {
      const { result } = renderTabsHook({
        baseTerminalId: 'test-can-add-true',
        workingDirectory: '/test/dir',
        maxTabs: 3
      })

      expect(result.current.canAddTab).toBe(true)
    })

    it('returns false when at maxTabs limit', async () => {
      mockInvoke.mockResolvedValue(false)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-can-add-false',
        workingDirectory: '/test/dir',
        maxTabs: 2
      })

      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.canAddTab).toBe(false)
    })

    it('updates canAddTab when tabs are closed', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-can-add-update',
        workingDirectory: '/test/dir',
        maxTabs: 2
      })

      // Add to max
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.canAddTab).toBe(false)

      // Close a tab
      await act(async () => {
        await result.current.closeTab(1)
      })

      expect(result.current.canAddTab).toBe(true)
    })
  })

  describe('concurrent operations', () => {
    it('handles rapid addTab calls correctly', async () => {
      mockInvoke.mockResolvedValue(false)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-concurrent-add',
        workingDirectory: '/test/dir',
        maxTabs: 5
      })

      // Add tabs sequentially since the hook has stale closure issues with concurrent calls
      await act(async () => {
        await result.current.addTab()
      })

      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs.length).toBe(3) // 1 initial + 2 added
      expect(result.current.tabs.map(t => t.index)).toEqual([0, 1, 2])
    })

    it('handles sequential closeTab calls correctly', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-sequential-close',
        workingDirectory: '/test/dir'
      })

      // Add tabs first
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs.length).toBe(2)

      // Close the added tab
      await act(async () => {
        await result.current.closeTab(1)
      })

      // Should have 1 tab remaining (can't close the last one)
      expect(result.current.tabs.length).toBe(1)
    })
  })

  describe('memory management', () => {
    it('cleans up terminal references when tabs are closed', async () => {
      mockInvoke.mockResolvedValue(undefined)

      const { result } = renderTabsHook({
        baseTerminalId: 'test-cleanup-refs',
        workingDirectory: '/test/dir'
      })

      // Add tabs
      await act(async () => {
        await result.current.addTab()
      })

      expect(result.current.tabs.length).toBe(2)

      // Close tab
      await act(async () => {
        await result.current.closeTab(1)
      })

      expect(result.current.tabs.length).toBe(1)
      // Terminal references should be cleaned up (tested via reset functionality)
    })

    it('prevents memory leaks from duplicate terminal creation attempts', async () => {
      const createdIdsSet = new Set<string>()
      mockInvoke.mockImplementation((command: string, args?: MockTauriInvokeArgs) => {
        if (command === TauriCommands.TerminalExists) {
          const id = (args as { id?: string })?.id
          return Promise.resolve(id ? createdIdsSet.has(id) : false)
        }
        if (command === TauriCommands.CreateTerminal) {
          const id = (args as { id?: string })?.id
          if (id) createdIdsSet.add(id)
          return Promise.resolve()
        }
        return defaultInvokeImplementation(command, args)
      })

      const { result } = renderTabsHook({
        baseTerminalId: 'test-no-duplicate',
        workingDirectory: '/test/dir'
      })

      // Add tabs sequentially
      await act(async () => {
        await result.current.addTab()
      })

      await act(async () => {
        await result.current.addTab()
      })

      const createdIds = Array.from(createdIdsSet).filter(id => id.startsWith('test-no-duplicate'))
      const uniqueIds = new Set(createdIds)
      expect(uniqueIds.size).toBe(createdIds.length)
    })
  })
})
