import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSessionManagement } from './useSessionManagement'
import { invoke } from '@tauri-apps/api/core'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

// Mock window.dispatchEvent
const mockDispatchEvent = vi.fn()
Object.defineProperty(window, 'dispatchEvent', {
    value: mockDispatchEvent,
    writable: true
})

describe('useSessionManagement', () => {
    const mockTerminals = {
        top: 'test-terminal-top',
        bottomBase: 'test-terminal-bottom'
    }

    const mockClearTerminalTracking = vi.fn()
    const mockClearTerminalStartedTracking = vi.fn()
    const mockInvoke = vi.mocked(invoke)

    beforeEach(() => {
        vi.clearAllMocks()
        mockInvoke.mockResolvedValue(true)
    })

    describe('resetSession', () => {
        it('should reset commander session', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'commander' as const }

            await act(async () => {
                await result.current.resetSession(selection, mockTerminals)
            })

            expect(mockInvoke).toHaveBeenCalledWith('para_core_reset_orchestrator', {
                terminalId: 'test-terminal-top'
            })
            expect(mockDispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'schaltwerk:reset-terminals' })
            )
        })

        it('should reset session agent', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { 
                kind: 'session' as const, 
                payload: 'test-session' 
            }

            mockInvoke
                .mockResolvedValueOnce(true) // terminal_exists
                .mockResolvedValueOnce(undefined) // close_terminal
                .mockResolvedValueOnce(undefined) // para_core_start_claude

            await act(async () => {
                await result.current.resetSession(selection, mockTerminals)
            })

            expect(mockInvoke).toHaveBeenCalledWith('terminal_exists', {
                id: 'test-terminal-top'
            })
            expect(mockInvoke).toHaveBeenCalledWith('close_terminal', {
                id: 'test-terminal-top'
            })
            expect(mockInvoke).toHaveBeenCalledWith('para_core_start_claude', {
                sessionName: 'test-session'
            })
            expect(mockDispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'schaltwerk:reset-terminals' })
            )
        })

        it('should handle terminal not existing for session reset', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { 
                kind: 'session' as const, 
                payload: 'test-session' 
            }

            mockInvoke
                .mockResolvedValueOnce(false) // terminal_exists returns false
                .mockResolvedValueOnce(undefined) // para_core_start_claude

            await act(async () => {
                await result.current.resetSession(selection, mockTerminals)
            })

            expect(mockInvoke).not.toHaveBeenCalledWith('close_terminal', expect.any(Object))
            expect(mockInvoke).toHaveBeenCalledWith('para_core_start_claude', {
                sessionName: 'test-session'
            })
        })

        it('should track resetting state', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'commander' as const }

            expect(result.current.isResetting).toBe(false)

            const resetPromise = act(async () => {
                await result.current.resetSession(selection, mockTerminals)
            })

            await resetPromise
            expect(result.current.isResetting).toBe(false)
        })

        it('should not reset if already resetting', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'commander' as const }

            // Mock a slow invoke to keep resetting state
            let resolveInvoke: () => void
            const slowPromise = new Promise<void>(resolve => {
                resolveInvoke = resolve
            })
            mockInvoke.mockReturnValueOnce(slowPromise)

            // Start first reset (but don't await it yet)
            act(() => {
                result.current.resetSession(selection, mockTerminals)
            })

            // Try to reset again while first is in progress - this should be ignored
            await act(async () => {
                await result.current.resetSession(selection, mockTerminals)
            })

            // Should only call invoke once (from first reset)
            expect(mockInvoke).toHaveBeenCalledTimes(1)

            // Now resolve the first reset
            resolveInvoke!()
            await act(async () => {
                await slowPromise
            })
        })
    })

    describe('switchModel', () => {
        it('should switch model for commander', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'commander' as const }

            mockInvoke
                .mockResolvedValueOnce(undefined) // para_core_set_agent_type
                .mockResolvedValueOnce(true) // terminal_exists
                .mockResolvedValueOnce(undefined) // close_terminal
                .mockResolvedValueOnce(undefined) // para_core_start_claude_orchestrator

            expect(result.current).not.toBeNull()
            
            await act(async () => {
                await result.current!.switchModel(
                    'gemini', 
                    selection, 
                    mockTerminals,
                    mockClearTerminalTracking,
                    mockClearTerminalStartedTracking
                )
            })

            expect(mockInvoke).toHaveBeenCalledWith('para_core_set_agent_type', {
                agentType: 'gemini'
            })
            expect(mockInvoke).toHaveBeenCalledWith('para_core_start_claude_orchestrator', {
                terminalId: 'test-terminal-top'
            })
            expect(mockClearTerminalTracking).toHaveBeenCalledWith(['test-terminal-top'])
            expect(mockClearTerminalStartedTracking).toHaveBeenCalledWith(['test-terminal-top'])
        })

        it('should switch model for session', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { 
                kind: 'session' as const, 
                payload: 'test-session' 
            }

            mockInvoke
                .mockResolvedValueOnce(undefined) // para_core_set_session_agent_type
                .mockResolvedValueOnce(true) // terminal_exists
                .mockResolvedValueOnce(undefined) // close_terminal
                .mockResolvedValueOnce(undefined) // para_core_start_claude

            await act(async () => {
                await result.current!.switchModel(
                    'cursor', 
                    selection, 
                    mockTerminals,
                    mockClearTerminalTracking,
                    mockClearTerminalStartedTracking
                )
            })

            expect(mockInvoke).toHaveBeenCalledWith('para_core_set_session_agent_type', {
                sessionName: 'test-session',
                agentType: 'cursor'
            })
            expect(mockInvoke).toHaveBeenCalledWith('para_core_start_claude', {
                sessionName: 'test-session'
            })
            expect(mockClearTerminalTracking).toHaveBeenCalledWith(['test-terminal-top'])
            expect(mockClearTerminalStartedTracking).toHaveBeenCalledWith(['test-terminal-top'])
        })

        it('should handle terminal not existing during model switch', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'commander' as const }

            mockInvoke
                .mockResolvedValueOnce(undefined) // para_core_set_agent_type
                .mockResolvedValueOnce(false) // terminal_exists returns false
                .mockResolvedValueOnce(undefined) // para_core_start_claude_orchestrator

            await act(async () => {
                await result.current!.switchModel(
                    'claude', 
                    selection, 
                    mockTerminals,
                    mockClearTerminalTracking,
                    mockClearTerminalStartedTracking
                )
            })

            expect(mockInvoke).not.toHaveBeenCalledWith('close_terminal', expect.any(Object))
            expect(mockInvoke).toHaveBeenCalledWith('para_core_start_claude_orchestrator', {
                terminalId: 'test-terminal-top'
            })
        })

        it('should dispatch reset terminals event after model switch', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'commander' as const }

            await act(async () => {
                await result.current!.switchModel(
                    'opencode', 
                    selection, 
                    mockTerminals,
                    mockClearTerminalTracking,
                    mockClearTerminalStartedTracking
                )
            })

            expect(mockDispatchEvent).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'schaltwerk:reset-terminals' })
            )
        })
    })

    describe('error handling', () => {
        it('should handle errors in resetSession and reset state', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'commander' as const }
            
            mockInvoke.mockRejectedValueOnce(new Error('Test error'))

            await act(async () => {
                await expect(
                    result.current.resetSession(selection, mockTerminals)
                ).rejects.toThrow('Test error')
            })

            expect(result.current.isResetting).toBe(false)
        })

        it('should handle errors in switchModel', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'commander' as const }
            
            mockInvoke.mockRejectedValueOnce(new Error('Switch error'))

            await act(async () => {
                await expect(
                    result.current!.switchModel(
                        'claude',
                        selection, 
                        mockTerminals,
                        mockClearTerminalTracking,
                        mockClearTerminalStartedTracking
                    )
                ).rejects.toThrow('Switch error')
            })
        })
    })
})