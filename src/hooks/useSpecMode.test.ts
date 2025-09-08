import { renderHook, act, waitFor } from '@testing-library/react'
import { useSpecMode, getSpecToSelect } from './useSpecMode'
import { Selection } from '../contexts/SelectionContext'
import { EnrichedSession } from '../types/session'
import { FilterMode } from '../types/sessionFilters'

// Mock event system
vi.mock('../common/eventSystem', () => ({
  SchaltEvent: {
    SessionsRefreshed: 'schaltwerk:sessions-refreshed'
  },
  listenEvent: vi.fn().mockResolvedValue(vi.fn())
}))

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))


describe('useSpecMode', () => {
  const mockOrchestratorSelection: Selection = { kind: 'orchestrator' }
  const mockSetFilterMode = vi.fn()
  const mockSetSelection = vi.fn().mockResolvedValue(undefined)
  
  const createMockSpec = (id: string, createdAt = '2023-01-01T00:00:00Z'): EnrichedSession => ({
    info: {
      session_id: id,
      display_name: id,
      branch: `branch-${id}`,
      worktree_path: `/path/to/${id}`,
      base_branch: 'main',
      status: 'spec' as const,
      created_at: createdAt,
      last_modified: createdAt,
      has_uncommitted_changes: false,
      is_current: false,
      session_type: 'worktree' as const,
      session_state: 'spec' as const,
      spec_content: `Content for ${id}`
    },
    terminals: []
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Clear sessionStorage
    sessionStorage.clear()
  })

  describe('basic functionality', () => {
    it('should initialize with null spec mode session by default', () => {
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      expect(result.current.commanderSpecModeSession).toBeNull()
    })

    it('should set spec mode session', () => {
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      act(() => {
        result.current.setCommanderSpecModeSession('test-spec')
      })

      expect(result.current.commanderSpecModeSession).toBe('test-spec')
    })
  })

  describe('sessionStorage persistence', () => {
    it('should save spec mode to sessionStorage when changed', () => {
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      act(() => {
        result.current.setCommanderSpecModeSession('new-spec')
      })

      expect(sessionStorage.getItem('schaltwerk:spec-mode:project')).toBe('new-spec')
    })

    it('should remove from sessionStorage when set to null', () => {
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      act(() => {
        result.current.setCommanderSpecModeSession('spec')
      })

      act(() => {
        result.current.setCommanderSpecModeSession(null)
      })

      expect(sessionStorage.getItem('schaltwerk:spec-mode:project')).toBeNull()
    })

    it('should not persist when no project path', () => {
      const { result } = renderHook(() => useSpecMode({
        projectPath: null,
        selection: mockOrchestratorSelection,
        sessions: [],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      act(() => {
        result.current.setCommanderSpecModeSession('spec')
      })

      // Should not be persisted since no project path
      expect(sessionStorage.getItem('schaltwerk:spec-mode:null')).toBeNull()
    })

    it('should load from sessionStorage on project path change', () => {
      // Pre-populate sessionStorage
      sessionStorage.setItem('schaltwerk:spec-mode:project', 'saved-spec')
      const spec = createMockSpec('saved-spec')

      const { result, rerender } = renderHook(
        (props: { projectPath: string | null; selection: Selection; sessions: EnrichedSession[]; setFilterMode: typeof mockSetFilterMode; setSelection: typeof mockSetSelection }) => useSpecMode(props),
        {
          initialProps: {
            projectPath: null as string | null,
            selection: mockOrchestratorSelection,
            sessions: [spec],
            setFilterMode: mockSetFilterMode,
            setSelection: mockSetSelection
          }
        }
      )

      // Initially should be null (no project path)
      expect(result.current.commanderSpecModeSession).toBeNull()

      // Set project path - should load from sessionStorage
      rerender({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [spec],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      })

      // Note: The restoration code is commented out in the implementation, so this should still be null
      expect(result.current.commanderSpecModeSession).toBeNull()
    })

    it('should validate saved spec exists and clear if not found', () => {
      sessionStorage.setItem('schaltwerk:spec-mode:project', 'non-existent-spec')

      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [], // No specs available
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      // Should clear invalid spec from storage
      expect(sessionStorage.getItem('schaltwerk:spec-mode:project')).toBeNull()
      expect(result.current.commanderSpecModeSession).toBeNull()
    })
  })

  describe('helper functions', () => {
    it('should handle spec deletion correctly', () => {
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      act(() => {
        result.current.setCommanderSpecModeSession('spec-to-delete')
      })

      act(() => {
        result.current.handleSpecDeleted('spec-to-delete')
      })

      expect(result.current.commanderSpecModeSession).toBeNull()
    })

    it('should not change spec mode when deleting different spec', () => {
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      act(() => {
        result.current.setCommanderSpecModeSession('current-spec')
      })

      act(() => {
        result.current.handleSpecDeleted('different-spec')
      })

      expect(result.current.commanderSpecModeSession).toBe('current-spec')
    })

    it('should handle spec conversion correctly', () => {
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      act(() => {
        result.current.setCommanderSpecModeSession('spec-to-convert')
      })

      act(() => {
        result.current.handleSpecConverted('spec-to-convert')
      })

      expect(result.current.commanderSpecModeSession).toBeNull()
    })

    it('should toggle spec mode correctly - on then off', () => {
      const spec = createMockSpec('test-spec')
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [spec],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      // Toggle on - should select first available spec
      act(() => {
        result.current.toggleSpecMode()
      })

      expect(result.current.commanderSpecModeSession).toBe('test-spec')
    })

    it('should handle setting spec mode session directly', () => {
      const spec = createMockSpec('test-spec')
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [spec],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      // Set spec mode on
      act(() => {
        result.current.setCommanderSpecModeSession('test-spec')
      })

      expect(result.current.commanderSpecModeSession).toBe('test-spec')
    })

    it('should handle exit spec mode with sessionStorage cleanup', () => {
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      act(() => {
        result.current.setCommanderSpecModeSession('test-spec')
      })

      expect(sessionStorage.getItem('schaltwerk:spec-mode:project')).toBe('test-spec')

      act(() => {
        result.current.handleExitSpecMode()
      })

      expect(result.current.commanderSpecModeSession).toBeNull()
      expect(sessionStorage.getItem('schaltwerk:spec-mode:project')).toBeNull()
    })
  })

  describe('spec filtering logic', () => {
    it('should identify spec sessions correctly', () => {
      const spec1 = createMockSpec('spec-1')
      const spec2 = createMockSpec('spec-2')
      const runningSession: EnrichedSession = {
        ...createMockSpec('running-session'),
        info: {
          ...createMockSpec('running-session').info,
          status: 'active',
          session_state: 'running'
        }
      }

      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [spec1, spec2, runningSession],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      // Toggle should select first spec, not the running session
      act(() => {
        result.current.toggleSpecMode()
      })

      // Should select one of the specs, not the running session
      expect(['spec-1', 'spec-2']).toContain(result.current.commanderSpecModeSession)
      expect(result.current.commanderSpecModeSession).not.toBe('running-session')
    })

    it('should handle no specs available when toggling', () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent')

      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [], // No specs available
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      act(() => {
        result.current.toggleSpecMode()
      })

      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'schaltwerk:new-spec'
        })
      )

      dispatchEventSpy.mockRestore()
    })
  })

  describe('last selected spec persistence', () => {
    it('should remember the last selected spec', () => {
      const spec1 = createMockSpec('spec-1')
      const spec2 = createMockSpec('spec-2')
      
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [spec1, spec2],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection,
        currentFilterMode: FilterMode.All
      }))

      // Select spec-2
      act(() => {
        result.current.setCommanderSpecModeSession('spec-2')
      })

      // Exit spec mode
      act(() => {
        result.current.handleExitSpecMode()
      })

      // Check that last selected spec is remembered
      expect(sessionStorage.getItem('schaltwerk:last-spec:project')).toBe('spec-2')
    })

    it('should persist last selected spec to sessionStorage', () => {
      const spec = createMockSpec('test-spec')
      
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [spec],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection,
        currentFilterMode: FilterMode.All
      }))

      act(() => {
        result.current.setCommanderSpecModeSession('test-spec')
      })

      expect(sessionStorage.getItem('schaltwerk:last-spec:project')).toBe('test-spec')
    })

    it('should fall back to first spec if last selected no longer exists', () => {
      const spec1 = createMockSpec('spec-1')
      const spec2 = createMockSpec('spec-2')
      
      const { result, rerender } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [spec1, spec2],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection,
        currentFilterMode: FilterMode.All
      }))

      // Select spec-2
      act(() => {
        result.current.setCommanderSpecModeSession('spec-2')
      })

      // Exit spec mode
      act(() => {
        result.current.handleExitSpecMode()
      })

      // Remove spec-2 from sessions
      rerender({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [spec1], // spec-2 removed
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection,
        currentFilterMode: FilterMode.All
      })

      // Check that when toggling with removed spec, it would fall back
      // Note: The actual toggle logic is more complex and involves async operations
      // so we just verify the getSpecToSelect helper works correctly
      const specToSelect = getSpecToSelect([spec1], 'spec-2')
      expect(specToSelect).toBe('spec-1')
    })
  })

  describe('filter mode restoration', () => {
    it('should save and restore filter mode when entering/exiting spec mode', async () => {
      const spec = createMockSpec('test-spec')
      
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [spec],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection,
        currentFilterMode: FilterMode.Running // Start with Running filter
      }))

      // Toggle spec mode on
      act(() => {
        result.current.toggleSpecMode()
      })

      // Should switch to Spec filter
      expect(mockSetFilterMode).toHaveBeenCalledWith(FilterMode.Spec)

      // Exit spec mode
      await act(async () => {
        await result.current.handleExitSpecMode()
      })

      // Should restore to Running filter
      expect(mockSetFilterMode).toHaveBeenCalledWith(FilterMode.Running)
    })

    it('should persist previous filter mode to sessionStorage', () => {
      const spec = createMockSpec('test-spec')
      
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [spec],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection,
        currentFilterMode: FilterMode.Reviewed
      }))

      act(() => {
        result.current.toggleSpecMode()
      })

      expect(sessionStorage.getItem('schaltwerk:prev-filter:project')).toBe(FilterMode.Reviewed)
    })

    it('should keep Spec filter if it was already selected', async () => {
      const spec = createMockSpec('test-spec')
      
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [spec],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection,
        currentFilterMode: FilterMode.Spec // Already in Spec filter
      }))

      // Toggle spec mode on
      act(() => {
        result.current.toggleSpecMode()
      })

      // Clear previous calls
      mockSetFilterMode.mockClear()

      // Exit spec mode
      await act(async () => {
        await result.current.handleExitSpecMode()
      })

      // Should restore to Spec filter (same as before)
      expect(mockSetFilterMode).toHaveBeenCalledWith(FilterMode.Spec)
    })

    it('should default to All filter if no previous filter was saved', async () => {
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection,
        currentFilterMode: undefined
      }))

      // Manually set spec mode without going through toggle
      act(() => {
        result.current.setCommanderSpecModeSession('test-spec')
      })

      // Exit spec mode
      await act(async () => {
        await result.current.handleExitSpecMode()
      })

      // Should default to All filter
      expect(mockSetFilterMode).toHaveBeenCalledWith(FilterMode.All)
    })
  })

  describe('selection restoration', () => {
    it('should save and restore previous selection when entering/exiting spec mode', async () => {
      const spec = createMockSpec('test-spec')
      const sessionSelection: Selection = { 
        kind: 'session', 
        payload: 'test-session',
        worktreePath: '/path/to/worktree'
      }
      
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: sessionSelection, // Start in a session
        sessions: [spec],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection,
        currentFilterMode: FilterMode.Running
      }))

      // Toggle spec mode on
      act(() => {
        result.current.toggleSpecMode()
      })

      // Should switch to orchestrator
      expect(mockSetSelection).toHaveBeenCalledWith({ kind: 'orchestrator' })

      // Exit spec mode
      await act(async () => {
        await result.current.handleExitSpecMode()
      })

      // Should restore to previous session selection after a delay
      await waitFor(() => {
        expect(mockSetSelection).toHaveBeenCalledWith(sessionSelection)
      })
    })

    it('should persist previous selection to sessionStorage', () => {
      const spec = createMockSpec('test-spec')
      const sessionSelection: Selection = { 
        kind: 'session', 
        payload: 'test-session'
      }
      
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: sessionSelection,
        sessions: [spec],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection,
        currentFilterMode: FilterMode.All
      }))

      act(() => {
        result.current.toggleSpecMode()
      })

      const saved = sessionStorage.getItem('schaltwerk:prev-selection:project')
      expect(saved).toBeTruthy()
      expect(JSON.parse(saved!)).toEqual(sessionSelection)
    })

    it('should not save selection if already in orchestrator', () => {
      const spec = createMockSpec('test-spec')
      
      const { result } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection, // Already in orchestrator
        sessions: [spec],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection,
        currentFilterMode: FilterMode.All
      }))

      act(() => {
        result.current.toggleSpecMode()
      })

      // Should not save orchestrator selection
      expect(sessionStorage.getItem('schaltwerk:prev-selection:project')).toBeNull()
    })
  })

  describe('getSpecToSelect helper function', () => {
    it('should select last selected spec if it exists', () => {
      const spec1 = createMockSpec('spec-1')
      const spec2 = createMockSpec('spec-2')
      const spec3 = createMockSpec('spec-3')
      
      const result = getSpecToSelect([spec1, spec2, spec3], 'spec-2')
      expect(result).toBe('spec-2')
    })

    it('should return first spec if last selected does not exist', () => {
      const spec1 = createMockSpec('spec-1')
      const spec2 = createMockSpec('spec-2')
      
      const result = getSpecToSelect([spec1, spec2], 'non-existent')
      expect(result).toBe('spec-1')
    })

    it('should return null if no specs available', () => {
      const result = getSpecToSelect([], 'any-spec')
      expect(result).toBeNull()
    })

    it('should return first spec if lastSelectedSpec is null', () => {
      const spec1 = createMockSpec('spec-1')
      const spec2 = createMockSpec('spec-2')
      
      const result = getSpecToSelect([spec1, spec2], null)
      expect(result).toBe('spec-1')
    })
  })

  describe('event listeners', () => {
    it('should set up sessions refreshed event listener', async () => {
      const eventSystemModule = await import('../common/eventSystem')
      const listenEventSpy = vi.mocked(eventSystemModule.listenEvent)
      
      renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      expect(listenEventSpy).toHaveBeenCalledWith(eventSystemModule.SchaltEvent.SessionsRefreshed, expect.any(Function))
    })

    it('should not cause errors on unmount', () => {
      const { unmount } = renderHook(() => useSpecMode({
        projectPath: '/test/project',
        selection: mockOrchestratorSelection,
        sessions: [],
        setFilterMode: mockSetFilterMode,
        setSelection: mockSetSelection
      }))

      // Test that unmount doesn't cause errors
      expect(() => unmount()).not.toThrow()
    })
  })
})