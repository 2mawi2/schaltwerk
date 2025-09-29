import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, screen, waitFor, act } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'

// Use real keyboard hook behavior

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(), UnlistenFn: vi.fn() }))

// Mock the useProject hook to always return a project path
vi.mock('../../contexts/ProjectContext', async () => {
  const actual = await vi.importActual<typeof import('../../contexts/ProjectContext')>('../../contexts/ProjectContext')
  return {
    ...actual,
    useProject: () => ({
      projectPath: '/test/project',
      setProjectPath: vi.fn()
    })
  }
})

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'


async function press(key: string, opts: KeyboardEventInit = {}) {
  await act(async () => {
    const event = new KeyboardEvent('keydown', { key, ...opts })
    window.dispatchEvent(event)
  })
}

describe('Sidebar keyboard navigation basic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh)', configurable: true })

    const sessions = [
      { info: { session_id: 'a', branch: 'para/a', worktree_path: '/a', base_branch: 'main', status: 'active', is_current: false, session_type: 'worktree' }, terminals: [] },
      { info: { session_id: 'b', branch: 'para/b', worktree_path: '/b', base_branch: 'main', status: 'active', is_current: false, session_type: 'worktree' }, terminals: [] },
      { info: { session_id: 'c', branch: 'para/c', worktree_path: '/c', base_branch: 'main', status: 'active', is_current: false, session_type: 'worktree' }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
            if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.ListAvailableOpenApps) return [{ id: 'finder', name: 'Finder', kind: 'system' }]
      if (cmd === TauriCommands.GetDefaultOpenApp) return 'finder'
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })

    vi.mocked(listen).mockImplementation(async () => {
      return () => {}
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Cmd+ArrowDown selects first session from orchestrator; Cmd+ArrowUp returns to orchestrator', async () => {
    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      const items = screen.getAllByRole('button')
      expect(items.some(b => (b.textContent || '').includes('orchestrator'))).toBe(true)
      expect(items.filter(b => (b.textContent || '').includes('para/'))).toHaveLength(3)
    })

    // Orchestrator selected by default (has blue ring class)
    const orchestratorBtn = screen.getByTitle(/Select orchestrator/i)
    expect(orchestratorBtn.className).toContain('session-ring-blue')

    // Move down
    await press('ArrowDown', { metaKey: true })

    await waitFor(() => {
      expect(screen.getByTitle(/Selected session/)).toBeInTheDocument()
    })

    // Move up to orchestrator
    await press('ArrowUp', { metaKey: true })

    await waitFor(() => {
      const orch = screen.getByTitle(/Select orchestrator/i)
      expect(orch.className).toContain('session-ring-blue')
    })
  })

  it('prevents marking spec sessions as reviewed', async () => {
    // Mock console.warn to verify it's called for spec sessions
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Mock sessions with a spec session
    const sessions = [
      { info: { session_id: 'spec-session', branch: 'spec/branch', worktree_path: '/spec', base_branch: 'main',  status: 'spec', session_state: 'spec', is_current: false, session_type: 'worktree', ready_to_merge: false }, terminals: [] },
      { info: { session_id: 'running-session', branch: 'running/branch', worktree_path: '/running', base_branch: 'main',  status: 'active', is_current: false, session_type: 'worktree', ready_to_merge: false }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.ListAvailableOpenApps) return [{ id: 'finder', name: 'Finder', kind: 'system' }]
      if (cmd === TauriCommands.GetDefaultOpenApp) return 'finder'
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })

    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      expect(screen.getByText('spec-session')).toBeInTheDocument()
      expect(screen.getByText('running-session')).toBeInTheDocument()
    })

    // Select the spec session
    const specButton = screen.getByText('spec-session').closest('[role="button"]') as HTMLElement | null
    if (specButton) {
      specButton.click()
    }

    // Wait for selection to be updated
    await waitFor(() => {
      const selectedSpecButton = screen.getByText('spec-session').closest('[role="button"]')
      expect(selectedSpecButton?.className).toContain('session-ring')
    })

    // Try to mark spec as ready with Cmd+R - should log warning and not open modal
    await press('r', { metaKey: true })

    // Verify warning was logged
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Cannot mark spec "spec-session" as reviewed')
    )

    // Modal should not appear
    await waitFor(() => {
      expect(screen.queryByText('Mark Session as Reviewed')).not.toBeInTheDocument()
    })

    // Now select the running session
    const runningButton = screen.getByText('running-session').closest('[role="button"]') as HTMLElement | null
    if (runningButton) {
      runningButton.click()
    }

    // Wait for selection to be updated
    await waitFor(() => {
      const selectedRunningButton = screen.getByText('running-session').closest('[role="button"]')
      expect(selectedRunningButton?.className).toContain('session-ring')
    })

    // Clear previous console calls
    consoleWarnSpy.mockClear()

    // Try to mark running session as ready with Cmd+R - should open modal (no warning)
    await press('r', { metaKey: true })

    // Verify no warning was logged for running session
    expect(consoleWarnSpy).not.toHaveBeenCalled()

    // Modal should appear
    await waitFor(() => {
      expect(screen.getByText('Mark Session as Reviewed')).toBeInTheDocument()
    })

    consoleWarnSpy.mockRestore()
  })

  it('prevents converting spec sessions to specs with Cmd+S', async () => {
    // Mock sessions with a spec session and a running session
    const sessions = [
      { info: { session_id: 'spec-session', branch: 'spec/branch', worktree_path: '/spec', base_branch: 'main',  status: 'spec', session_state: 'spec', is_current: false, session_type: 'worktree', ready_to_merge: false }, terminals: [] },
      { info: { session_id: 'running-session', branch: 'running/branch', worktree_path: '/running', base_branch: 'main',  status: 'active', is_current: false, session_type: 'worktree', ready_to_merge: false }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessionsSorted) return sessions
      if (cmd === TauriCommands.SchaltwerkCoreListSessionsByState) return []
      if (cmd === TauriCommands.GetCurrentDirectory) return '/cwd'
      if (cmd === TauriCommands.TerminalExists) return false
      if (cmd === TauriCommands.CreateTerminal) return true
      if (cmd === TauriCommands.ListAvailableOpenApps) return [{ id: 'finder', name: 'Finder', kind: 'system' }]
      if (cmd === TauriCommands.GetDefaultOpenApp) return 'finder'
      if (cmd === TauriCommands.GetProjectSessionsSettings) {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === TauriCommands.SetProjectSessionsSettings) {
        return undefined
      }
      return undefined
    })

    render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      expect(screen.getByText('spec-session')).toBeInTheDocument()
      expect(screen.getByText('running-session')).toBeInTheDocument()
    })

    // Select the spec session
    const specButton = screen.getByText('spec-session').closest('[role="button"]') as HTMLElement | null
    if (specButton) {
      specButton.click()
    }

    // Wait for selection to be updated
    await waitFor(() => {
      const selectedSpecButton = screen.getByText('spec-session').closest('[role="button"]')
      expect(selectedSpecButton?.className).toContain('session-ring')
    })

    // Try to convert spec to spec with Cmd+S - should not open modal
    await press('s', { metaKey: true })

    // Modal should not appear
    await waitFor(() => {
      expect(screen.queryByText('Convert to Spec')).not.toBeInTheDocument()
    })

    // Now select the running session
    const runningButton = screen.getByText('running-session').closest('[role="button"]') as HTMLElement | null
    if (runningButton) {
      runningButton.click()
    }

    // Wait for selection to be updated
    await waitFor(() => {
      const selectedRunningButton = screen.getByText('running-session').closest('[role="button"]')
      expect(selectedRunningButton?.className).toContain('session-ring')
    })

    // Try to convert running session to spec with Cmd+S - should open modal
    await press('s', { metaKey: true })

    // Modal should appear
    await waitFor(() => {
      expect(screen.getByText('Convert to Spec')).toBeInTheDocument()
    })
  })

})
