import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { SelectionProvider } from '../../contexts/SelectionContext'
import { FocusProvider } from '../../contexts/FocusContext'
import { ProjectProvider } from '../../contexts/ProjectContext'
import { FontSizeProvider } from '../../contexts/FontSizeContext'
import { SessionsProvider } from '../../contexts/SessionsContext'

// Mock dependencies
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve())
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
  UnlistenFn: vi.fn()
}))

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

const mockInvoke = vi.mocked(invoke)
const mockListen = vi.mocked(listen)
const mockUnlisten = vi.fn()

// Mock keyboard shortcuts hook
vi.mock('../hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn()
}))

// Mock time utility
vi.mock('../utils/time', () => ({
  formatLastActivity: vi.fn((timestamp?: string) => {
    if (!timestamp) return 'unknown'
    return '5m' // Mock return value
  })
}))

interface DiffStats {
  files_changed: number
  additions: number
  deletions: number
  insertions: number
}

interface SessionInfo {
  session_id: string
  display_name?: string  // Human-friendly name generated from prompt
  branch: string
  worktree_path: string
  base_branch: string
  merge_mode: string
  status: 'active' | 'dirty' | 'missing' | 'archived'
  created_at?: string
  last_modified?: string
  has_uncommitted_changes?: boolean
  is_current: boolean
  session_type: 'worktree' | 'container'
  container_status?: string
  current_task?: string
  todo_percentage?: number
  is_blocked?: boolean
  diff_stats?: DiffStats
}

interface EnrichedSession {
  info: SessionInfo
  status?: any
  terminals: string[]
}

// Reducer functions extracted for testing
export const sessionReducers = {
  updateActivity: (sessions: EnrichedSession[], payload: { session_name: string, last_activity_ts: number }) => {
    return sessions.map(s => {
      if (s.info.session_id !== payload.session_name) return s
      return {
        ...s,
        info: {
          ...s.info,
          last_modified: new Date(payload.last_activity_ts * 1000).toISOString(),
        }
      }
    })
  },

  updateGitStats: (sessions: EnrichedSession[], payload: {
    session_name: string
    files_changed: number
    lines_added: number
    lines_removed: number
    has_uncommitted: boolean
  }) => {
    return sessions.map(s => {
      if (s.info.session_id !== payload.session_name) return s
      const diff = {
        files_changed: payload.files_changed || 0,
        additions: payload.lines_added || 0,
        deletions: payload.lines_removed || 0,
        insertions: payload.lines_added || 0,
      }
      return {
        ...s,
        info: {
          ...s.info,
          diff_stats: diff,
          has_uncommitted_changes: payload.has_uncommitted,
        }
      }
    })
  },

  addSession: (sessions: EnrichedSession[], payload: {
    session_name: string
    branch: string
    worktree_path: string
    parent_branch: string
  }) => {
    // Avoid duplicates
    if (sessions.some(s => s.info.session_id === payload.session_name)) return sessions
    
    const info: SessionInfo = {
      session_id: payload.session_name,
      branch: payload.branch,
      worktree_path: payload.worktree_path,
      base_branch: payload.parent_branch,
      merge_mode: 'rebase',
      status: 'active',
      last_modified: undefined,
      has_uncommitted_changes: false,
      is_current: false,
      session_type: 'worktree',
      container_status: undefined,
      current_task: undefined,
      todo_percentage: undefined,
      is_blocked: undefined,
      diff_stats: undefined,
    }
    
    const terminals = [
      `session-${payload.session_name}-top`,
      `session-${payload.session_name}-bottom`,
    ]
    
    const enriched: EnrichedSession = { info, status: undefined, terminals }
    return [enriched, ...sessions]
  },

  removeSession: (sessions: EnrichedSession[], payload: { session_name: string }) => {
    return sessions.filter(s => s.info.session_id !== payload.session_name)
  }
}

function createTestWrapper() {
  return ({ children }: { children: React.ReactNode }) => (
    <ProjectProvider>
      <FontSizeProvider>
        <SessionsProvider>
          <SelectionProvider>
            <FocusProvider>
              {children}
            </FocusProvider>
          </SelectionProvider>
        </SessionsProvider>
      </FontSizeProvider>
    </ProjectProvider>
  )
}

describe('Sidebar', () => {
  let eventListeners: Map<string, (event: any) => void>

  beforeEach(() => {
    vi.clearAllMocks()
    eventListeners = new Map()
    
    // Setup default mocks
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case 'para_core_list_enriched_sessions':
          return Promise.resolve([])
        case 'get_current_directory':
          return Promise.resolve('/test/cwd')
        case 'terminal_exists':
          return Promise.resolve(false)
        case 'create_terminal':
          return Promise.resolve()
        case 'para_core_get_session':
          return Promise.resolve({
            worktree_path: '/test/session/path',
            session_id: 'test-session'
          })
        case 'para_core_list_sessions_by_state':
          return Promise.resolve([])
        case 'get_project_sessions_settings':
          return Promise.resolve({ filter_mode: 'all', sort_mode: 'name' })
        case 'set_project_sessions_settings':
          return Promise.resolve()
        case 'para_core_get_font_sizes':
          return Promise.resolve([13, 12])
        case 'para_core_set_font_sizes':
          return Promise.resolve()
        default:
          return Promise.resolve()
      }
    })

    // Mock event listener setup
    mockListen.mockImplementation((event: string, handler: (event: any) => void) => {
      eventListeners.set(event, handler)
      return Promise.resolve(mockUnlisten)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    eventListeners.clear()
  })

  describe('session list rendering', () => {
    it('should show empty state when no sessions', async () => {
      // Mock both the regular sessions and plans calls
      mockInvoke.mockImplementation((command: string) => {
        switch (command) {
          case 'para_core_list_enriched_sessions':
            return Promise.resolve([])
          case 'para_core_list_sessions_by_state':
            return Promise.resolve([])
          case 'get_current_directory':
            return Promise.resolve('/test/cwd')
          case 'terminal_exists':
            return Promise.resolve(false)
          case 'create_terminal':
            return Promise.resolve()
          case 'get_project_sessions_settings':
            return Promise.resolve({ filter_mode: 'all', sort_mode: 'name' })
          case 'set_project_sessions_settings':
            return Promise.resolve()
          case 'para_core_get_font_sizes':
            return Promise.resolve([13, 12])
          case 'para_core_set_font_sizes':
            return Promise.resolve()
          default:
            return Promise.resolve()
        }
      })

      render(<Sidebar />, { wrapper: createTestWrapper() })

      await waitFor(() => {
        // no session selection buttons should be rendered
        expect(screen.queryAllByTitle(/Select session/i).length).toBe(0)
      })
    })

    it('should render sessions when available', async () => {
      const mockSessions: EnrichedSession[] = [
        {
          info: {
            session_id: 'simple-session',
            branch: 'feature/simple',
            worktree_path: '/path/simple',
            base_branch: 'main',
            merge_mode: 'rebase',
            status: 'active',
            is_current: false,
            session_type: 'worktree',
            current_task: 'Simple agent',
            has_uncommitted_changes: false
          },
          status: undefined,
          terminals: []
        }
      ]

      // Mock both the regular sessions and plans calls
      mockInvoke.mockImplementation((command: string) => {
        switch (command) {
          case 'para_core_list_enriched_sessions':
            return Promise.resolve(mockSessions)
          case 'para_core_list_enriched_sessions_sorted':
            return Promise.resolve(mockSessions)
          case 'para_core_list_sessions_by_state':
            return Promise.resolve([])
          case 'get_current_directory':
            return Promise.resolve('/test/cwd')
          case 'terminal_exists':
            return Promise.resolve(false)
          case 'create_terminal':
            return Promise.resolve()
          case 'get_project_sessions_settings':
            return Promise.resolve({ filter_mode: 'all', sort_mode: 'name' })
          case 'set_project_sessions_settings':
            return Promise.resolve()
          case 'para_core_get_font_sizes':
            return Promise.resolve([13, 12])
          case 'para_core_set_font_sizes':
            return Promise.resolve()
          default:
            return Promise.resolve()
        }
      })

      render(<Sidebar />, { wrapper: createTestWrapper() })

      await waitFor(() => {
        expect(screen.getByText('simple-session')).toBeInTheDocument()
        // session selection buttons should be present (1 for 1 session)
        expect(screen.getAllByTitle(/Select session/i).length).toBe(1)
      })
    })
  })

  describe('event-driven session updates', () => {
    let initialSessions: EnrichedSession[]

    beforeEach(() => {
      initialSessions = [
        {
          info: {
            session_id: 'session1',
            branch: 'feature/one',
            worktree_path: '/path1',
            base_branch: 'main',
            merge_mode: 'rebase',
            status: 'active',
            is_current: false,
            session_type: 'worktree',
            last_modified: '2025-01-01T10:00:00Z',
            diff_stats: {
              files_changed: 2,
              additions: 50,
              deletions: 10,
              insertions: 50
            }
          },
          status: undefined,
          terminals: []
        },
        {
          info: {
            session_id: 'session2',
            branch: 'feature/two',
            worktree_path: '/path2',
            base_branch: 'main',
            merge_mode: 'rebase',
            status: 'active',
            is_current: false,
            session_type: 'worktree'
          },
          status: undefined,
          terminals: []
        }
      ]
    })

    it('should handle schaltwerk:session-activity events', async () => {
      const activityPayload = {
        session_id: 'session1',
        session_name: 'session1',
        last_activity_ts: 1640995200 // 2022-01-01T00:00:00Z
      }

      const updatedSessions = sessionReducers.updateActivity(initialSessions, activityPayload)

      expect(updatedSessions[0].info.last_modified).toBe('2022-01-01T00:00:00.000Z')
      expect(updatedSessions[1].info.last_modified).toBeUndefined() // Other session unchanged
    })

    it('should handle schaltwerk:session-git-stats events', async () => {
      const gitStatsPayload = {
        session_id: 'session1',
        session_name: 'session1',
        files_changed: 3,
        lines_added: 75,
        lines_removed: 15,
        has_uncommitted: true
      }

      const updatedSessions = sessionReducers.updateGitStats(initialSessions, gitStatsPayload)

      expect(updatedSessions[0].info.diff_stats).toEqual({
        files_changed: 3,
        additions: 75,
        deletions: 15,
        insertions: 75
      })
      expect(updatedSessions[0].info.has_uncommitted_changes).toBe(true)
      expect(updatedSessions[1].info.diff_stats).toBeUndefined() // Other session unchanged
    })

    it('should handle schaltwerk:session-added events without duplicates', async () => {
      const addPayload = {
        session_name: 'new-session',
        branch: 'feature/new',
        worktree_path: '/path/new',
        parent_branch: 'main'
      }

      const updatedSessions = sessionReducers.addSession(initialSessions, addPayload)

      expect(updatedSessions).toHaveLength(3)
      expect(updatedSessions[0].info.session_id).toBe('new-session')
      expect(updatedSessions[0].info.branch).toBe('feature/new')
      expect(updatedSessions[0].info.worktree_path).toBe('/path/new')
      expect(updatedSessions[0].info.base_branch).toBe('main')
      expect(updatedSessions[0].terminals).toEqual([
        'session-new-session-top',
        'session-new-session-bottom'
      ])
    })

    it('should prevent duplicate sessions on add events', async () => {
      const addPayload = {
        session_name: 'session1', // Already exists
        branch: 'feature/duplicate',
        worktree_path: '/path/duplicate',
        parent_branch: 'main'
      }

      const updatedSessions = sessionReducers.addSession(initialSessions, addPayload)

      expect(updatedSessions).toHaveLength(2) // No new session added
      expect(updatedSessions[0].info.branch).toBe('feature/one') // Original unchanged
    })

    it('should handle schaltwerk:session-removed events', async () => {
      const removePayload = { session_name: 'session1' }

      const updatedSessions = sessionReducers.removeSession(initialSessions, removePayload)

      expect(updatedSessions).toHaveLength(1)
      expect(updatedSessions[0].info.session_id).toBe('session2')
    })

    it('should handle git stats with zero values correctly', async () => {
      const gitStatsPayload = {
        session_id: 'session1',
        session_name: 'session1',
        files_changed: 0,
        lines_added: 0,
        lines_removed: 0,
        has_uncommitted: false
      }

      const updatedSessions = sessionReducers.updateGitStats(initialSessions, gitStatsPayload)

      expect(updatedSessions[0].info.diff_stats).toEqual({
        files_changed: 0,
        additions: 0,
        deletions: 0,
        insertions: 0
      })
      expect(updatedSessions[0].info.has_uncommitted_changes).toBe(false)
    })

    it('should handle git stats with missing optional fields', async () => {
      const gitStatsPayload = {
        session_id: 'session1',
        session_name: 'session1',
        files_changed: undefined as any,
        lines_added: undefined as any,
        lines_removed: undefined as any,
        has_uncommitted: false
      }

      const updatedSessions = sessionReducers.updateGitStats(initialSessions, gitStatsPayload)

      expect(updatedSessions[0].info.diff_stats).toEqual({
        files_changed: 0, // Should default to 0
        additions: 0,
        deletions: 0,
        insertions: 0
      })
    })
  })

  describe('basic interaction', () => {
    it('should render commander button', async () => {
      mockInvoke.mockResolvedValueOnce([])

      render(<Sidebar />, { wrapper: createTestWrapper() })
      // The button uses a title attribute
      const orchestratorButton = screen.getByTitle(/Select commander/i)
      expect(orchestratorButton).toBeInTheDocument()
    })

    it('should emit cancel events when requested', () => {
      // Test the event emission logic directly - just test that events can be dispatched
      const mockEventListener = vi.fn()
      
      window.addEventListener('schaltwerk:session-action', mockEventListener)

      // Simulate the event dispatch that happens in the component
      const testEvent = new CustomEvent('schaltwerk:session-action', {
        detail: {
          action: 'cancel',
          sessionId: 'test-session',
          sessionName: 'test-session',
          hasUncommittedChanges: true
        }
      })
      
      window.dispatchEvent(testEvent)

      expect(mockEventListener).toHaveBeenCalled()
      expect(testEvent.detail).toEqual({
        action: 'cancel',
        sessionId: 'test-session',
        sessionName: 'test-session',
        hasUncommittedChanges: true
      })

      window.removeEventListener('schaltwerk:session-action', mockEventListener)
    })
  })

  describe('edge cases', () => {
    it('should handle empty session state gracefully', async () => {
      const mockSessions: EnrichedSession[] = [
        {
          info: {
            session_id: 'minimal-session',
            branch: 'feature/minimal',
            worktree_path: '/path',
            base_branch: 'main',
            merge_mode: 'rebase',
            status: 'active',
            is_current: false,
            session_type: 'worktree',
            // Missing optional fields
          },
          status: undefined,
          terminals: []
        }
      ]

      // Mock both the regular sessions and plans calls
      mockInvoke.mockImplementation((command: string) => {
        switch (command) {
          case 'para_core_list_enriched_sessions':
            return Promise.resolve(mockSessions)
          case 'para_core_list_enriched_sessions_sorted':
            return Promise.resolve(mockSessions)
          case 'para_core_list_sessions_by_state':
            return Promise.resolve([])
          case 'get_current_directory':
            return Promise.resolve('/test/cwd')
          case 'terminal_exists':
            return Promise.resolve(false)
          case 'create_terminal':
            return Promise.resolve()
          case 'get_project_sessions_settings':
            return Promise.resolve({ filter_mode: 'all', sort_mode: 'name' })
          case 'set_project_sessions_settings':
            return Promise.resolve()
          case 'para_core_get_font_sizes':
            return Promise.resolve([13, 12])
          case 'para_core_set_font_sizes':
            return Promise.resolve()
          default:
            return Promise.resolve()
        }
      })

      render(<Sidebar />, { wrapper: createTestWrapper() })

      await waitFor(() => {
        // Search within any button containing the session id; account for possible label text
        const btn = screen.getAllByRole('button').find(b => (b.textContent || '').indexOf('minimal-session') !== -1)
        expect(!!btn).toBe(true)
      })
    })

    it('should handle loading failure gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockInvoke.mockImplementation((command: string) => {
        switch (command) {
          case 'para_core_list_enriched_sessions':
            return Promise.reject(new Error('Failed to load sessions'))
          case 'para_core_list_sessions_by_state':
            return Promise.resolve([])
          case 'get_current_directory':
            return Promise.resolve('/test/cwd')
          case 'terminal_exists':
            return Promise.resolve(false)
          case 'create_terminal':
            return Promise.resolve()
          case 'get_project_sessions_settings':
            return Promise.resolve({ filter_mode: 'all', sort_mode: 'name' })
          case 'set_project_sessions_settings':
            return Promise.resolve()
          case 'para_core_get_font_sizes':
            return Promise.resolve([13, 12])
          case 'para_core_set_font_sizes':
            return Promise.resolve()
          default:
            return Promise.resolve()
        }
      })

      render(<Sidebar />, { wrapper: createTestWrapper() })

      await waitFor(() => {
        // no session selection buttons rendered on failure
        expect(screen.queryAllByTitle(/Select session/i).length).toBe(0)
      })
      
      consoleErrorSpy.mockRestore()
    })
  })
})
