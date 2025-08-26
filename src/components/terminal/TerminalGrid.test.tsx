import { forwardRef, useEffect, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'

// ---- Mocks (must be declared before importing the component) ----

// Mock react-split to capture props and render children
vi.mock('react-split', () => {
  let lastProps: any = null
  const SplitMock = ({ children, ...props }: any) => {
    lastProps = props
    return (
      <div
        data-testid="split"
        data-direction={props.direction}
        data-sizes={JSON.stringify(props.sizes)}
        data-minsize={props.minSize}
        data-gutter={props.gutterSize}
        className="h-full flex flex-col"
      >
        {children}
      </div>
    )
  }
  function __getLastProps() {
    return lastProps
  }
  return { default: SplitMock, __getLastProps }
})

// Spy-able store for our Terminal mock
const mountCount = new Map<string, number>()
const unmountCount = new Map<string, number>()
const focusSpies = new Map<string, ReturnType<typeof vi.fn>>()

// Mock the Terminal component used by TerminalGrid
vi.mock('./Terminal', () => {
  const TerminalMock = forwardRef<any, any>(function TerminalMock(props, ref) {
    const { terminalId, className = '', sessionName, isCommander } = props
    const focus = vi.fn()
    focusSpies.set(terminalId, focus)
    useEffect(() => {
      mountCount.set(terminalId, (mountCount.get(terminalId) || 0) + 1)
      return () => {
        unmountCount.set(terminalId, (unmountCount.get(terminalId) || 0) + 1)
        focusSpies.delete(terminalId)
      }
    }, [terminalId])

    useImperativeHandle(ref, () => ({ focus }), [focus])

    const handleClick = () => {
      focus()
    }

    return (
      <div
        data-testid={`terminal-${terminalId}`}
        data-terminal-id={terminalId}
        data-session-name={sessionName || ''}
        data-commander={isCommander ? '1' : '0'}
        className={className}
        onClick={handleClick}
      />
    )
  })

  function __getFocusSpy(id: string) {
    return focusSpies.get(id)
  }
  function __getMountCount(id: string) {
    return mountCount.get(id) || 0
  }
  function __getUnmountCount(id: string) {
    return unmountCount.get(id) || 0
  }

  return {
    Terminal: TerminalMock,
    __getFocusSpy,
    __getMountCount,
    __getUnmountCount,
  }
})

// Mock TerminalTabs to work with the mount counting system
vi.mock('./TerminalTabs', () => {
  const TerminalTabsMock = forwardRef<any, any>(function TerminalTabsMock(props, ref) {
    const { baseTerminalId, isCommander } = props
    // For commander, add -0 suffix; for sessions, no suffix
    const terminalId = isCommander ? `${baseTerminalId}-0` : baseTerminalId
    const focus = vi.fn()
    
    // Track mount for the tab terminal and register focus spy
    useEffect(() => {
      mountCount.set(terminalId, (mountCount.get(terminalId) || 0) + 1)
      focusSpies.set(terminalId, focus) // Register focus spy directly
      return () => {
        unmountCount.set(terminalId, (unmountCount.get(terminalId) || 0) + 1)
        focusSpies.delete(terminalId)
      }
    }, [terminalId, focus])

    useImperativeHandle(ref, () => ({ focus }), [focus])

    const handleClick = () => {
      focus()
    }

    return (
      <div data-testid={`terminal-tabs-${baseTerminalId}`}>
        <div
          data-testid={`terminal-${terminalId}`}
          className="h-full w-full"
          onClick={handleClick}
        >
          Mock Terminal Tab {terminalId}
        </div>
      </div>
    )
  })
  
  return {
    TerminalTabs: TerminalTabsMock
  }
})

// Mock Tauri core invoke used by SelectionContext (providers in tests)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

// Now import component under test and helpers
import { TerminalGrid } from './TerminalGrid'
import { TestProviders } from '../../tests/test-utils'
import { useSelection } from '../../contexts/SelectionContext'
import { useFocus } from '../../contexts/FocusContext'

// Bridge to call context setters from tests sharing the same provider tree
let bridge: {
  setSelection: ReturnType<typeof useSelection>['setSelection']
  setCurrentFocus: ReturnType<typeof useFocus>['setCurrentFocus']
  setFocusForSession: ReturnType<typeof useFocus>['setFocusForSession']
  getFocusForSession: ReturnType<typeof useFocus>['getFocusForSession']
  getSessionKey: () => string
  isReady: boolean
  terminals: ReturnType<typeof useSelection>['terminals']
} | null = null

function ControlBridge() {
  const { selection, setSelection, isReady, terminals } = useSelection()
  const { setCurrentFocus, setFocusForSession, getFocusForSession } = useFocus()
  useEffect(() => {
    bridge = {
      setSelection,
      setCurrentFocus,
      setFocusForSession,
      getFocusForSession,
      getSessionKey: () => (selection.kind === 'commander' ? 'commander' : selection.payload || 'unknown'),
      isReady,
      terminals,
    }
  }, [selection, setSelection, setCurrentFocus, setFocusForSession, getFocusForSession, isReady, terminals])
  return null
}


beforeEach(() => {
  vi.useFakeTimers()
  mountCount.clear()
  unmountCount.clear()
  // Don't clear focusSpies here - let components register them after mounting
  vi.clearAllMocks()

  mockInvoke.mockImplementation((command: string, args?: any) => {
    switch (command) {
      case 'get_current_directory':
        return Promise.resolve('/test/cwd')
      case 'terminal_exists':
        // Terminal doesn't exist initially, forcing creation
        return Promise.resolve(false)
      case 'create_terminal':
        // Mark as created
        const terminalId = args?.id
        if (terminalId) {
          mountCount.set(terminalId, 0) // Mark as created but not yet mounted
        }
        return Promise.resolve()
      case 'schaltwerk_core_get_session':
        return Promise.resolve({
          worktree_path: '/session/worktree',
          session_id: args?.name || 'test-session',
        })
      case 'get_project_action_buttons':
        return Promise.resolve([])
      default:
        return Promise.resolve(undefined)
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
  bridge = null
  focusSpies.clear()
})

function renderGrid() {
  return render(
    <TestProviders>
      <ControlBridge />
      <TerminalGrid />
    </TestProviders>
  )
}

describe('TerminalGrid', () => {
  it('renders dual-terminal layout with correct headers and ids (commander)', async () => {
    renderGrid()
    // Use real timers to allow async initialization to complete
    vi.useRealTimers()

    // Wait for bridge to be ready with increased timeout
    await waitFor(() => {
      expect(bridge).toBeDefined()
      expect(bridge?.isReady).toBe(true)
    }, { timeout: 3000 })

    // Headers should be visible
    expect(screen.getByText('Commander — main repo')).toBeInTheDocument()
    expect(screen.getByText('Terminal — main')).toBeInTheDocument()

    // Terminal components should use the actual IDs from the context
    if (!bridge) throw new Error('Bridge not initialized')
    expect(screen.getByTestId(`terminal-${bridge.terminals.top}`)).toBeInTheDocument()
    // Bottom terminal is now inside TerminalTabs with -0 suffix for commander
    const bottomTerminalId = bridge.terminals.bottomBase.includes('commander') ? `${bridge.terminals.bottomBase}-0` : bridge.terminals.bottomBase
    expect(screen.getByTestId(`terminal-${bottomTerminalId}`)).toBeInTheDocument()
  })

  it('respects split view proportions and layout props', async () => {
    renderGrid()
    // Use real timers to allow async initialization to complete
    vi.useRealTimers()
    
    // Wait for bridge to be ready with increased timeout
    await waitFor(() => {
      expect(bridge).toBeDefined()
      expect(bridge?.isReady).toBe(true)
    }, { timeout: 3000 })
    
    const split = screen.getByTestId('split')
    expect(split.getAttribute('data-direction')).toBe('vertical')
    expect(split.getAttribute('data-sizes')).toBe(JSON.stringify([65, 35]))
    // minSize may be a single number or an array (top,bottom)
    const minsizeAttr = split.getAttribute('data-minsize') || ''
    expect(minsizeAttr === '120' || minsizeAttr === '120,24' || minsizeAttr === '[120,24]').toBe(true)
    expect(split.getAttribute('data-gutter')).toBe('8')
  })

  it('focuses top/bottom terminals on header and body clicks', async () => {
    renderGrid()
    // Use real timers to allow async initialization to complete
    vi.useRealTimers()

    // Wait for bridge to be ready with increased timeout
    await waitFor(() => {
      expect(bridge).toBeDefined()
      expect(bridge?.isReady).toBe(true)
    }, { timeout: 3000 })

    // Click top header -> focus claude (top) after 100ms
    fireEvent.click(screen.getByText('Commander — main repo'))
    await new Promise(r => setTimeout(r, 120))
    const topFocus = (await import('./Terminal')) as any
    expect(topFocus.__getFocusSpy(bridge!.terminals.top)).toHaveBeenCalled()

    // Click bottom header -> focus terminal (bottom)
    fireEvent.click(screen.getByText('Terminal — main'))
    await new Promise(r => setTimeout(r, 120))
    const bottomFocusSpy = (await import('./Terminal')) as any
    const bottomTerminalId = bridge!.terminals.bottomBase.includes('commander') ? `${bridge!.terminals.bottomBase}-0` : bridge!.terminals.bottomBase
    expect(bottomFocusSpy.__getFocusSpy(bottomTerminalId)).toHaveBeenCalled()

    // Also clicking terminals directly should focus
    const topTerminal = screen.getByTestId(`terminal-${bridge!.terminals.top}`)
    const bottomTerminal = screen.getByTestId(`terminal-${bottomTerminalId}`)
    fireEvent.click(topTerminal)
    await new Promise(r => setTimeout(r, 120))
    expect(topFocus.__getFocusSpy(bridge!.terminals.top)).toHaveBeenCalled()
    fireEvent.click(bottomTerminal)
    await new Promise(r => setTimeout(r, 120))
    expect(bottomFocusSpy.__getFocusSpy(bottomTerminalId)).toHaveBeenCalled()
  })

  it('switches terminals when session changes and focuses according to session focus state', async () => {
    renderGrid()
    // Use real timers for findBy* polling to avoid hang with fake timers
    vi.useRealTimers()

    // Wait for provider initialization
    await waitFor(() => {
      if (!bridge) throw new Error('bridge not ready')
      expect(bridge.isReady).toBe(true)
    }, { timeout: 2000 })

    // Change selection to a session
    await act(async () => {
      await bridge!.setSelection({ kind: 'session', payload: 'dev', worktreePath: '/dev/path' })
    })
    // allow state to settle
    await Promise.resolve()

    // Headers reflect new session
    expect(await screen.findByText('Agent — dev', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('Terminal — dev')).toBeInTheDocument()

    // New terminal ids mounted (remounted due to key change)
    expect(screen.getByTestId('terminal-session-dev-top')).toBeInTheDocument()
    // Bottom terminal is now in tabs, wait for it to be created
    await waitFor(() => {
      expect(screen.getByTestId('terminal-session-dev-bottom')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Click headers to drive focus
    const m = (await import('./Terminal')) as any
    fireEvent.click(screen.getByText('Terminal — dev'))
    await new Promise(r => setTimeout(r, 120))
    // Focus is now on the bottom terminal
    expect(m.__getFocusSpy('session-dev-bottom')).toHaveBeenCalled()
    fireEvent.click(screen.getByText('Agent — dev'))
    await new Promise(r => setTimeout(r, 120))
    expect(m.__getFocusSpy('session-dev-top')).toHaveBeenCalled()
  })

  it('handles terminal reset events by remounting terminals and cleans up on unmount', async () => {
    const utils = renderGrid()
    // Use real timers to allow async initialization to complete
    vi.useRealTimers()

    // Wait for bridge to be ready with increased timeout
    await waitFor(() => {
      expect(bridge).toBeDefined()
      expect(bridge?.isReady).toBe(true)
    }, { timeout: 3000 })

    const m = (await import('./Terminal')) as any
    const topId = bridge!.terminals.top
    const bottomId = bridge!.terminals.bottomBase.includes('commander') ? bridge!.terminals.bottomBase + '-0' : bridge!.terminals.bottomBase // Tab terminal has -0 suffix for commander only
    
    expect(m.__getMountCount(topId)).toBe(1)
    
    // Wait for bottom terminal tab to be created asynchronously
    await waitFor(() => {
      expect(m.__getMountCount(bottomId)).toBe(1)
    }, { timeout: 3000 })

    // Dispatch reset event -> key increments -> both terminals remount
    act(() => {
      window.dispatchEvent(new Event('schaltwerk:reset-terminals'))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(m.__getMountCount(topId)).toBe(2)
    expect(m.__getMountCount(bottomId)).toBe(2)

    // Unmount component -> listener should be removed; subsequent events won't change counts
    utils.unmount()
    // Each terminal should have unmounted at least once
    expect(m.__getUnmountCount(topId)).toBeGreaterThan(0)
    expect(m.__getUnmountCount(bottomId)).toBeGreaterThan(0)
    act(() => {
      window.dispatchEvent(new Event('schaltwerk:reset-terminals'))
    })

    // After the reset, terminals should have been remounted (count of 2)
    expect(m.__getMountCount(topId)).toBe(2)
    expect(m.__getMountCount(bottomId)).toBe(2)
  })

  describe('Terminal Minimization', () => {
    it('toggles terminal collapse state correctly', async () => {
      renderGrid()
      vi.useRealTimers()

      // Wait for initialization
      await waitFor(() => {
        expect(bridge).toBeDefined()
        expect(bridge?.isReady).toBe(true)
      }, { timeout: 3000 })

      // Initially not collapsed - both panels visible
      expect(screen.getByText('Commander — main repo')).toBeInTheDocument()
      expect(screen.getByText('Terminal — main')).toBeInTheDocument()
      expect(screen.getByTestId('split')).toBeInTheDocument()

      // Find and click the collapse button (chevron down icon)
      const collapseButton = screen.getByLabelText('Collapse terminal panel')
      fireEvent.click(collapseButton)

      // After collapse, split view should still be present but with adjusted sizes
      await waitFor(() => {
        expect(screen.getByTestId('split')).toBeInTheDocument()
        // Terminal header should still be visible
        expect(screen.getByText(/Terminal — /)).toBeInTheDocument()
      })

      // Claude section should still be visible
      expect(screen.getByText('Commander — main repo')).toBeInTheDocument()

      // Click expand button to expand again
      const expandButton = screen.getByLabelText('Expand terminal panel')
      fireEvent.click(expandButton)

      // Should still have split view, terminal content should be visible
      await waitFor(() => {
        expect(screen.getByTestId('split')).toBeInTheDocument()
        const collapseButton2 = screen.getByLabelText('Collapse terminal panel')
        expect(collapseButton2).toBeInTheDocument()
      })
    })

    it('persists collapse state per session in localStorage', async () => {
      // Clear localStorage to start fresh
      localStorage.clear()

      renderGrid()
      vi.useRealTimers()

      await waitFor(() => {
        expect(bridge).toBeDefined()
        expect(bridge?.isReady).toBe(true)
      }, { timeout: 3000 })

      // Collapse terminal for commander
      const collapseButton = screen.getByLabelText('Collapse terminal panel')
      fireEvent.click(collapseButton)

      // Wait for collapse to take effect
      await waitFor(() => {
        const expandBtn = screen.getByLabelText('Expand terminal panel')
        expect(expandBtn).toBeInTheDocument()
      })

      // Check localStorage was updated for commander
      expect(localStorage.getItem('schaltwerk:terminal-grid:collapsed:commander')).toBe('true')

      // Switch to a session
      await act(async () => {
        await bridge!.setSelection({ kind: 'session', payload: 'test-session', worktreePath: '/test/path' })
      })

      // Wait for session to load
      await waitFor(() => {
        expect(screen.getByText('Agent — test-session')).toBeInTheDocument()
      })

      // Agent should inherit the collapsed state from commander since it has no localStorage entry
      expect(screen.getByTestId('split')).toBeInTheDocument()
      const expandBtn = screen.getByLabelText('Expand terminal panel')
      expect(expandBtn).toBeInTheDocument()
      // The inherited collapsed state is immediately persisted
      expect(localStorage.getItem('schaltwerk:terminal-grid:collapsed:test-session')).toBe('true')

      // First expand it
      fireEvent.click(expandBtn)
      
      await waitFor(() => {
        const collapseBtn = screen.getByLabelText('Collapse terminal panel')
        expect(collapseBtn).toBeInTheDocument()
      })

      // Now collapse terminal for this session
      const sessionCollapseButton = screen.getByLabelText('Collapse terminal panel')
      fireEvent.click(sessionCollapseButton)

      await waitFor(() => {
        const expandBtn2 = screen.getByLabelText('Expand terminal panel')
        expect(expandBtn2).toBeInTheDocument()
      })

      expect(localStorage.getItem('schaltwerk:terminal-grid:collapsed:test-session')).toBe('true')

      // Switch back to commander
      await act(async () => {
        await bridge!.setSelection({ kind: 'commander', payload: undefined, worktreePath: undefined })
      })

      // Wait for commander to load
      await waitFor(() => {
        expect(screen.getByText('Commander — main repo')).toBeInTheDocument()
      })

      // Commander should still be collapsed (state was persisted)
      const expandBtnOrch = screen.getByLabelText('Expand terminal panel')
      expect(expandBtnOrch).toBeInTheDocument()
      expect(screen.getByTestId('split')).toBeInTheDocument()
    })

    it('restores correct minimization state when switching between sessions', async () => {
      // Set up different collapse states in localStorage
      localStorage.setItem('schaltwerk:terminal-grid:collapsed:commander', 'false')
      localStorage.setItem('schaltwerk:terminal-grid:collapsed:session-a', 'true')
      localStorage.setItem('schaltwerk:terminal-grid:collapsed:session-b', 'false')

      renderGrid()
      vi.useRealTimers()

      await waitFor(() => {
        expect(bridge).toBeDefined()
        expect(bridge?.isReady).toBe(true)
      }, { timeout: 3000 })

      // Commander starts not collapsed
      expect(screen.getByTestId('split')).toBeInTheDocument()
      const collapseBtn = screen.getByLabelText('Collapse terminal panel')
      expect(collapseBtn).toBeInTheDocument()

      // Switch to session-a (should be collapsed)
      await act(async () => {
        await bridge!.setSelection({ kind: 'session', payload: 'session-a', worktreePath: '/a/path' })
      })

      await waitFor(() => {
        expect(screen.getByText('Agent — session-a')).toBeInTheDocument()
        const expandBtn = screen.getByLabelText('Expand terminal panel')
        expect(expandBtn).toBeInTheDocument()
        expect(screen.getByTestId('split')).toBeInTheDocument()
      })

      // Switch to session-b (should not be collapsed)
      await act(async () => {
        await bridge!.setSelection({ kind: 'session', payload: 'session-b', worktreePath: '/b/path' })
      })

      await waitFor(() => {
        expect(screen.getByText('Agent — session-b')).toBeInTheDocument()
        expect(screen.getByTestId('split')).toBeInTheDocument()
        const collapseBtn = screen.getByLabelText('Collapse terminal panel')
        expect(collapseBtn).toBeInTheDocument()
      })

      // Switch back to session-a (should still be collapsed)
      await act(async () => {
        await bridge!.setSelection({ kind: 'session', payload: 'session-a', worktreePath: '/a/path' })
      })

      await waitFor(() => {
        expect(screen.getByText('Agent — session-a')).toBeInTheDocument()
        const expandBtn = screen.getByLabelText('Expand terminal panel')
        expect(expandBtn).toBeInTheDocument()
        expect(screen.getByTestId('split')).toBeInTheDocument()
      })
    })

    it('expands terminal when clicking expand button while collapsed', async () => {
      // Pre-set collapsed state for the test session
      localStorage.setItem('schaltwerk:terminal-grid:collapsed:test', 'true')
      
      renderGrid()
      vi.useRealTimers()

      await waitFor(() => {
        expect(bridge).toBeDefined()
        expect(bridge?.isReady).toBe(true)
      }, { timeout: 3000 })

      // Switch to the test session which has collapsed state
      await act(async () => {
        await bridge!.setSelection({ kind: 'session', payload: 'test', worktreePath: '/test' })
      })

      await waitFor(() => {
        expect(screen.getByText('Agent — test')).toBeInTheDocument()
      })

      // Terminal should be collapsed for this session (from localStorage)
      const expandBtn = screen.getByLabelText('Expand terminal panel')
      expect(expandBtn).toBeInTheDocument()

      // Click expand button to expand
      fireEvent.click(expandBtn)

      // Should expand the terminal
      await waitFor(() => {
        expect(screen.getByTestId('split')).toBeInTheDocument()
        const collapseBtn = screen.getByLabelText('Collapse terminal panel')
        expect(collapseBtn).toBeInTheDocument()
      })

      // Terminal should be visible and functional after expansion
      expect(screen.getByText('Terminal — test')).toBeInTheDocument()
      expect(screen.getByTestId('terminal-session-test-bottom')).toBeInTheDocument()
    })

    it('maintains correct UI state when rapidly toggling collapse', async () => {
      renderGrid()
      vi.useRealTimers()

      await waitFor(() => {
        expect(bridge).toBeDefined()
        expect(bridge?.isReady).toBe(true)
      }, { timeout: 3000 })

      // Rapidly toggle collapse state
      const collapseButton = screen.getByLabelText('Collapse terminal panel')
      
      // Collapse
      fireEvent.click(collapseButton)
      await waitFor(() => {
        const expandBtn = screen.getByLabelText('Expand terminal panel')
        expect(expandBtn).toBeInTheDocument()
      })

      // Expand
      const expandButton = screen.getByLabelText('Expand terminal panel')
      fireEvent.click(expandButton)
      await waitFor(() => {
        const collapseBtn = screen.getByLabelText('Collapse terminal panel')
        expect(collapseBtn).toBeInTheDocument()
      })

      // Collapse again
      const collapseButton2 = screen.getByLabelText('Collapse terminal panel')
      fireEvent.click(collapseButton2)
      await waitFor(() => {
        const expandBtn = screen.getByLabelText('Expand terminal panel')
        expect(expandBtn).toBeInTheDocument()
      })

      // Expand again
      const expandButton2 = screen.getByLabelText('Expand terminal panel')
      fireEvent.click(expandButton2)
      await waitFor(() => {
        const collapseBtn = screen.getByLabelText('Collapse terminal panel')
        expect(collapseBtn).toBeInTheDocument()
      })

      // Final state should be expanded and functional
      expect(screen.getByText('Commander — main repo')).toBeInTheDocument()
      expect(screen.getByText('Terminal — main')).toBeInTheDocument()
      const collapseBtn = screen.getByLabelText('Collapse terminal panel')
      expect(collapseBtn).toBeInTheDocument()
    })
  })
})
