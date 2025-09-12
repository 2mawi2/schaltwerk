import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSortedSessions } from './useSortedSessions'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { SortMode, FilterMode } from '../types/sessionFilters'
import { mockEnrichedSession, mockDraftSession } from '../test-utils/sessionMocks'

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn()
}))

// Mock ProjectContext
const mockUseProject = vi.fn()
vi.mock('../contexts/ProjectContext', () => ({
    useProject: () => mockUseProject()
}))

describe('useSortedSessions', () => {
    const mockInvoke = vi.mocked(invoke)
    const mockListen = vi.mocked(listen)
    const mockUnlisten = vi.fn()

    const mockSessions = [
        mockEnrichedSession('session-a', 'active'),
        mockEnrichedSession('session-b', 'dirty'),
        mockDraftSession('spec-c')
    ]

    beforeEach(() => {
        vi.clearAllMocks()
        mockUseProject.mockReturnValue({ projectPath: '/test/project' })
        mockInvoke.mockResolvedValue(mockSessions)
        mockListen.mockResolvedValue(mockUnlisten)
    })

    afterEach(() => {
        vi.clearAllTimers()
    })

    describe('initial state', () => {
        it('should initialize with empty sessions and start loading', () => {
            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            expect(result.current.sessions).toEqual([])
            expect(result.current.loading).toBe(true)
            expect(result.current.error).toBeNull()
        })

        it('should load sessions on mount when project path exists', async () => {
            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                // Wait for useEffect to run
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_list_enriched_sessions_sorted', {
                sortMode: SortMode.Name,
                filterMode: FilterMode.All
            })
            expect(result.current.sessions).toEqual(mockSessions)
            expect(result.current.loading).toBe(false)
        })

        it('should not load sessions when project path is null', async () => {
            mockUseProject.mockReturnValue({ projectPath: null })

            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockInvoke).not.toHaveBeenCalled()
            expect(result.current.sessions).toEqual([])
            expect(result.current.loading).toBe(false)
        })
    })

    describe('loading sessions', () => {
        it('should set loading state during session load', async () => {
            let resolveInvoke: () => void
            const loadingPromise = new Promise<void>(resolve => {
                resolveInvoke = resolve
            })
            mockInvoke.mockReturnValueOnce(loadingPromise)

            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            // Initial state - should start loading immediately
            expect(result.current.loading).toBe(true)

            // Resolve the promise
            resolveInvoke!()
            await act(async () => {
                await loadingPromise
            })

            expect(result.current.loading).toBe(false)
        })

        it('should handle successful session loading', async () => {
            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(result.current.sessions).toEqual(mockSessions)
            expect(result.current.error).toBeNull()
            expect(result.current.loading).toBe(false)
        })

        it('should handle null response from backend', async () => {
            mockInvoke.mockResolvedValueOnce(null)

            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(result.current.sessions).toEqual([])
            expect(result.current.error).toBeNull()
        })

        it('should handle errors during session loading', async () => {
            const testError = new Error('Failed to load sessions')
            mockInvoke.mockRejectedValueOnce(testError)

            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(result.current.sessions).toEqual([])
            expect(result.current.error).toBe('Failed to load sessions')
            expect(result.current.loading).toBe(false)
        })

        it('should handle non-Error objects as errors', async () => {
            mockInvoke.mockRejectedValueOnce('String error')

            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(result.current.error).toBe('String error')
        })
    })

    describe('sort and filter modes', () => {
        it.each([
            [SortMode.Name, FilterMode.All],
            [SortMode.Created, FilterMode.Spec],
            [SortMode.LastEdited, FilterMode.Running],
            [SortMode.Name, FilterMode.Reviewed]
        ])('should load sessions with sortMode=%s and filterMode=%s', async (sortMode, filterMode) => {
            renderHook(() =>
                useSortedSessions({ sortMode, filterMode })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_list_enriched_sessions_sorted', {
                sortMode,
                filterMode
            })
        })

        it('should reload sessions when sort mode changes', async () => {
            const { rerender } = renderHook(
                ({ sortMode }) => useSortedSessions({ sortMode, filterMode: FilterMode.All }),
                { initialProps: { sortMode: SortMode.Name } }
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockInvoke).toHaveBeenCalledTimes(1)

            rerender({ sortMode: SortMode.Created })

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockInvoke).toHaveBeenCalledTimes(2)
            expect(mockInvoke).toHaveBeenLastCalledWith('schaltwerk_core_list_enriched_sessions_sorted', {
                sortMode: SortMode.Created,
                filterMode: FilterMode.All
            })
        })

        it('should reload sessions when filter mode changes', async () => {
            const { rerender } = renderHook(
                ({ filterMode }) => useSortedSessions({ sortMode: SortMode.Name, filterMode }),
                { initialProps: { filterMode: FilterMode.All } }
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockInvoke).toHaveBeenCalledTimes(1)

            rerender({ filterMode: FilterMode.Spec })

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockInvoke).toHaveBeenCalledTimes(2)
            expect(mockInvoke).toHaveBeenLastCalledWith('schaltwerk_core_list_enriched_sessions_sorted', {
                sortMode: SortMode.Name,
                filterMode: FilterMode.Spec
            })
        })
    })

    describe('event listeners', () => {
        it('should set up event listeners when project path exists', async () => {
            renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockListen).toHaveBeenCalledTimes(3)
            expect(mockListen).toHaveBeenCalledWith('schaltwerk:sessions-refreshed', expect.any(Function))
            expect(mockListen).toHaveBeenCalledWith('schaltwerk:session-added', expect.any(Function))
            expect(mockListen).toHaveBeenCalledWith('schaltwerk:session-removed', expect.any(Function))
        })

        it('should not set up event listeners when project path is null', async () => {
            mockUseProject.mockReturnValue({ projectPath: null })

            renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockListen).not.toHaveBeenCalled()
        })

        it('should reload sessions when sessions-refreshed event is emitted', async () => {
            renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            // Get the event handler
            const refreshHandler = mockListen.mock.calls.find(call =>
                call[0] === 'schaltwerk:sessions-refreshed'
            )?.[1]

            expect(refreshHandler).toBeDefined()

            // Reset mock to track new calls
            mockInvoke.mockClear()

            // Emit the event
            await act(async () => {
                await refreshHandler!({ event: 'schaltwerk:sessions-refreshed', id: 1, payload: {} })
                // Wait for debounce (increased to 200ms)
                await new Promise(resolve => setTimeout(resolve, 250))
            })

            expect(mockInvoke).toHaveBeenCalledTimes(1)
        })

        it('should reload sessions when session-added event is emitted', async () => {
            renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            const addHandler = mockListen.mock.calls.find(call =>
                call[0] === 'schaltwerk:session-added'
            )?.[1]

            mockInvoke.mockClear()

            await act(async () => {
                await addHandler!({ event: 'schaltwerk:session-added', id: 1, payload: {} })
                // Wait for debounce (increased to 200ms)
                await new Promise(resolve => setTimeout(resolve, 250))
            })

            expect(mockInvoke).toHaveBeenCalledTimes(1)
        })

        it('should reload sessions when session-removed event is emitted', async () => {
            renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            const removeHandler = mockListen.mock.calls.find(call =>
                call[0] === 'schaltwerk:session-removed'
            )?.[1]

            mockInvoke.mockClear()

            await act(async () => {
                await removeHandler!({ event: 'schaltwerk:session-removed', id: 2, payload: {} })
                // Wait for debounce (increased to 200ms)
                await new Promise(resolve => setTimeout(resolve, 250))
            })

            expect(mockInvoke).toHaveBeenCalledTimes(1)
        })

        it('should clean up event listeners on unmount', async () => {
            const { unmount } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            unmount()

            // The unlisten promises should be resolved and called
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockUnlisten).toHaveBeenCalledTimes(3)
        })
    })

    describe('reloadSessions', () => {
        it('should provide reloadSessions function that reloads sessions', async () => {
            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            mockInvoke.mockClear()

            await act(async () => {
                await result.current.reloadSessions()
            })

            expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_list_enriched_sessions_sorted', {
                sortMode: SortMode.Name,
                filterMode: FilterMode.All
            })
        })

        it('should handle errors in reloadSessions', async () => {
            const testError = new Error('Reload failed')
            // Mock the first call (initial load) to succeed, second call (reload) to fail
            mockInvoke.mockResolvedValueOnce(mockSessions)
            mockInvoke.mockRejectedValueOnce(testError)

            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            // Clear the mock to track the reload call
            mockInvoke.mockClear()
            mockInvoke.mockRejectedValueOnce(testError)

            await act(async () => {
                await result.current.reloadSessions()
            })

            expect(result.current.error).toBe('Reload failed')
        })
    })

    describe('project path changes', () => {
        it('should reload sessions when project path changes from null to valid', async () => {
            mockUseProject.mockReturnValue({ projectPath: null })

            const { rerender } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockInvoke).not.toHaveBeenCalled()

            // Change project path
            mockUseProject.mockReturnValue({ projectPath: '/new/project' })

            rerender()

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockInvoke).toHaveBeenCalledTimes(1)
        })

        it('should clean up listeners and reload when project path changes from valid to null', async () => {
            mockUseProject.mockReturnValue({ projectPath: '/test/project' })

            const { rerender } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockListen).toHaveBeenCalledTimes(3)

            // Change project path to null
            mockUseProject.mockReturnValue({ projectPath: null })

            rerender()

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(mockUnlisten).toHaveBeenCalledTimes(3)
        })
    })

    describe('edge cases', () => {
        it('should handle empty sessions array from backend', async () => {
            mockInvoke.mockResolvedValueOnce([])

            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(result.current.sessions).toEqual([])
            expect(result.current.error).toBeNull()
        })

        it('should handle undefined response from backend', async () => {
            mockInvoke.mockResolvedValueOnce(undefined)

            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(result.current.sessions).toEqual([])
        })

        it('should handle malformed session data gracefully', async () => {
            const malformedSessions = [
                { invalid: 'data' },
                null,
                undefined
            ]
            mockInvoke.mockResolvedValueOnce(malformedSessions as unknown[])

            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            expect(result.current.sessions).toEqual(malformedSessions)
        })
    })

    describe('concurrent operations', () => {
        it('should handle multiple rapid reload calls', async () => {
            const { result } = renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            mockInvoke.mockClear()

            // Call reload multiple times rapidly
            await act(async () => {
                await Promise.all([
                    result.current.reloadSessions(),
                    result.current.reloadSessions(),
                    result.current.reloadSessions()
                ])
            })

            expect(mockInvoke).toHaveBeenCalledTimes(3)
        })

        it('should handle event emissions during loading', async () => {
            let resolveInvoke: () => void
            const loadingPromise = new Promise<void>(resolve => {
                resolveInvoke = resolve
            })
            mockInvoke.mockReturnValueOnce(loadingPromise)

            renderHook(() =>
                useSortedSessions({ sortMode: SortMode.Name, filterMode: FilterMode.All })
            )

            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0))
            })

            // While still loading, emit an event
            const refreshHandler = mockListen.mock.calls.find(call =>
                call[0] === 'schaltwerk:sessions-refreshed'
            )?.[1]

            await act(async () => {
                await refreshHandler!({ event: 'schaltwerk:sessions-refreshed', id: 3, payload: {} })
                // Wait for debounce (increased to 200ms)
                await new Promise(resolve => setTimeout(resolve, 250))
            })

            // Resolve the original load
            resolveInvoke!()
            await act(async () => {
                await loadingPromise
            })

            // Should have called invoke twice (initial load + event)
            expect(mockInvoke).toHaveBeenCalledTimes(2)
        })
    })
})