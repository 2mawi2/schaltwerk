import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { SelectionProvider } from '../../contexts/SelectionContext'
import { FocusProvider } from '../../contexts/FocusContext'
import { ProjectProvider } from '../../contexts/ProjectContext'
import { FontSizeProvider } from '../../contexts/FontSizeContext'
import { SessionsProvider } from '../../contexts/SessionsContext'

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

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ProjectProvider>
      <FontSizeProvider>
        <SessionsProvider>
          <SelectionProvider>
            <FocusProvider>
              {ui}
            </FocusProvider>
          </SelectionProvider>
        </SessionsProvider>
      </FontSizeProvider>
    </ProjectProvider>
  )
}

function press(key: string, opts: Partial<KeyboardEvent> = {}) {
  const ev = new KeyboardEvent('keydown', { key, ...opts })
  window.dispatchEvent(ev)
}

describe('Sidebar keyboard navigation basic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh)', configurable: true })

    const sessions = [
      { info: { session_id: 'a', branch: 'para/a', worktree_path: '/a', base_branch: 'main', merge_mode: 'rebase', status: 'active', is_current: false, session_type: 'worktree' }, terminals: [] },
      { info: { session_id: 'b', branch: 'para/b', worktree_path: '/b', base_branch: 'main', merge_mode: 'rebase', status: 'active', is_current: false, session_type: 'worktree' }, terminals: [] },
      { info: { session_id: 'c', branch: 'para/c', worktree_path: '/c', base_branch: 'main', merge_mode: 'rebase', status: 'active', is_current: false, session_type: 'worktree' }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'schaltwerk_core_list_enriched_sessions') return sessions
            if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') return sessions
      if (cmd === 'schaltwerk_core_list_sessions_by_state') return []
      if (cmd === 'get_current_directory') return '/cwd'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'list_available_open_apps') return [{ id: 'finder', name: 'Finder', kind: 'system' }]
      if (cmd === 'get_default_open_app') return 'finder'
      if (cmd === 'get_project_sessions_settings') {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === 'set_project_sessions_settings') {
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
    renderWithProviders(<Sidebar />)

    await waitFor(() => {
      const items = screen.getAllByRole('button')
      expect(items.some(b => (b.textContent || '').includes('orchestrator'))).toBe(true)
      expect(items.filter(b => (b.textContent || '').includes('para/'))).toHaveLength(3)
    })

    // Orchestrator selected by default (has blue ring class)
    const orchestratorBtn = screen.getByTitle(/Select orchestrator/i)
    expect(orchestratorBtn.className).toContain('session-ring-blue')

    // Move down
    press('ArrowDown', { metaKey: true })

    await waitFor(() => {
      expect(screen.getByTitle(/Selected session/)).toBeInTheDocument()
    })

    // Move up to orchestrator
    press('ArrowUp', { metaKey: true })

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
      { info: { session_id: 'spec-session', branch: 'spec/branch', worktree_path: '/spec', base_branch: 'main', merge_mode: 'rebase', status: 'spec', session_state: 'spec', is_current: false, session_type: 'worktree', ready_to_merge: false }, terminals: [] },
      { info: { session_id: 'running-session', branch: 'running/branch', worktree_path: '/running', base_branch: 'main', merge_mode: 'rebase', status: 'active', is_current: false, session_type: 'worktree', ready_to_merge: false }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'schaltwerk_core_list_enriched_sessions') return sessions
      if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') return sessions
      if (cmd === 'schaltwerk_core_list_sessions_by_state') return []
      if (cmd === 'get_current_directory') return '/cwd'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'list_available_open_apps') return [{ id: 'finder', name: 'Finder', kind: 'system' }]
      if (cmd === 'get_default_open_app') return 'finder'
      if (cmd === 'get_project_sessions_settings') {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === 'set_project_sessions_settings') {
        return undefined
      }
      return undefined
    })

    renderWithProviders(<Sidebar />)

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
    press('r', { metaKey: true })

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
    press('r', { metaKey: true })

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
      { info: { session_id: 'spec-session', branch: 'spec/branch', worktree_path: '/spec', base_branch: 'main', merge_mode: 'rebase', status: 'spec', session_state: 'spec', is_current: false, session_type: 'worktree', ready_to_merge: false }, terminals: [] },
      { info: { session_id: 'running-session', branch: 'running/branch', worktree_path: '/running', base_branch: 'main', merge_mode: 'rebase', status: 'active', is_current: false, session_type: 'worktree', ready_to_merge: false }, terminals: [] },
    ]

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === 'schaltwerk_core_list_enriched_sessions') return sessions
      if (cmd === 'schaltwerk_core_list_enriched_sessions_sorted') return sessions
      if (cmd === 'schaltwerk_core_list_sessions_by_state') return []
      if (cmd === 'get_current_directory') return '/cwd'
      if (cmd === 'terminal_exists') return false
      if (cmd === 'create_terminal') return true
      if (cmd === 'list_available_open_apps') return [{ id: 'finder', name: 'Finder', kind: 'system' }]
      if (cmd === 'get_default_open_app') return 'finder'
      if (cmd === 'get_project_sessions_settings') {
        return { filter_mode: 'all', sort_mode: 'name' }
      }
      if (cmd === 'set_project_sessions_settings') {
        return undefined
      }
      return undefined
    })

    renderWithProviders(<Sidebar />)

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
    press('s', { metaKey: true })

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
    press('s', { metaKey: true })

    // Modal should appear
    await waitFor(() => {
      expect(screen.getByText('Convert to Spec')).toBeInTheDocument()
    })
  })

})
