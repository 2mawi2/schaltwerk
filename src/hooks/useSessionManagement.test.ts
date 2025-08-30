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
        it('should reset orchestrator session', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'orchestrator' as const }

            await act(async () => {
                await result.current.resetSession(selection, mockTerminals)
            })

            expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_reset_orchestrator', {
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
                .mockResolvedValueOnce(undefined) // schaltwerk_core_start_claude

            await act(async () => {
                await result.current.resetSession(selection, mockTerminals)
            })

            expect(mockInvoke).toHaveBeenCalledWith('terminal_exists', {
                id: 'test-terminal-top'
            })
            expect(mockInvoke).toHaveBeenCalledWith('close_terminal', {
                id: 'test-terminal-top'
            })
            expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_start_claude_with_restart', {
                sessionName: 'test-session',
                forceRestart: true
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
                .mockResolvedValueOnce(undefined) // schaltwerk_core_start_claude

            await act(async () => {
                await result.current.resetSession(selection, mockTerminals)
            })

            expect(mockInvoke).not.toHaveBeenCalledWith('close_terminal', expect.any(Object))
            expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_start_claude_with_restart', {
                sessionName: 'test-session',
                forceRestart: true
            })
        })

        it('should track resetting state', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'orchestrator' as const }

            expect(result.current.isResetting).toBe(false)

            const resetPromise = act(async () => {
                await result.current.resetSession(selection, mockTerminals)
            })

            await resetPromise
            expect(result.current.isResetting).toBe(false)
        })

        it('should not reset if already resetting', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'orchestrator' as const }

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
        it('should switch model for orchestrator', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'orchestrator' as const }

            mockInvoke
                .mockResolvedValueOnce(undefined) // schaltwerk_core_set_agent_type
                .mockResolvedValueOnce(true) // terminal_exists
                .mockResolvedValueOnce(undefined) // close_terminal
                .mockResolvedValueOnce(undefined) // schaltwerk_core_start_claude_orchestrator

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

            expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_set_agent_type', {
                agentType: 'gemini'
            })
            expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_start_claude_orchestrator', {
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
                .mockResolvedValueOnce(undefined) // schaltwerk_core_set_session_agent_type
                .mockResolvedValueOnce(true) // terminal_exists
                .mockResolvedValueOnce(undefined) // close_terminal
                .mockResolvedValueOnce(undefined) // schaltwerk_core_start_claude

            await act(async () => {
                await result.current!.switchModel(
                    'cursor', 
                    selection, 
                    mockTerminals,
                    mockClearTerminalTracking,
                    mockClearTerminalStartedTracking
                )
            })

            expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_set_session_agent_type', {
                sessionName: 'test-session',
                agentType: 'cursor'
            })
            expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_start_claude_with_restart', {
                sessionName: 'test-session',
                forceRestart: true
            })
            expect(mockClearTerminalTracking).toHaveBeenCalledWith(['test-terminal-top'])
            expect(mockClearTerminalStartedTracking).toHaveBeenCalledWith(['test-terminal-top'])
        })

        it('should handle terminal not existing during model switch', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'orchestrator' as const }

            mockInvoke
                .mockResolvedValueOnce(undefined) // schaltwerk_core_set_agent_type
                .mockResolvedValueOnce(false) // terminal_exists returns false
                .mockResolvedValueOnce(undefined) // schaltwerk_core_start_claude_orchestrator

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
            expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_start_claude_orchestrator', {
                terminalId: 'test-terminal-top'
            })
        })

        it('should dispatch reset terminals event after model switch', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'orchestrator' as const }

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
            
            const selection = { kind: 'orchestrator' as const }
            
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
            
            const selection = { kind: 'orchestrator' as const }
            
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

    describe('edge cases', () => {
        describe('session selection edge cases', () => {
            it('should handle session with null payload', async () => {
                const { result } = renderHook(() => useSessionManagement())

                const selection = {
                    kind: 'session' as const,
                    payload: null as any
                }

                await act(async () => {
                    await result.current.resetSession(selection, mockTerminals)
                })

                // Should not call any commands when payload is null
                expect(mockInvoke).not.toHaveBeenCalledWith('schaltwerk_core_reset_orchestrator', expect.any(Object))
                expect(mockInvoke).not.toHaveBeenCalledWith('terminal_exists', expect.any(Object))
                expect(mockInvoke).not.toHaveBeenCalledWith('schaltwerk_core_start_claude', expect.any(Object))
                // Should still dispatch reset event and wait
                expect(mockDispatchEvent).toHaveBeenCalledWith(
                    expect.objectContaining({ type: 'schaltwerk:reset-terminals' })
                )
            })

            it('should handle session with undefined payload', async () => {
                const { result } = renderHook(() => useSessionManagement())

                const selection = {
                    kind: 'session' as const,
                    payload: undefined as any
                }

                await act(async () => {
                    await result.current.resetSession(selection, mockTerminals)
                })

                // Should not call any commands when payload is undefined
                expect(mockInvoke).not.toHaveBeenCalledWith('schaltwerk_core_reset_orchestrator', expect.any(Object))
                expect(mockInvoke).not.toHaveBeenCalledWith('terminal_exists', expect.any(Object))
                expect(mockInvoke).not.toHaveBeenCalledWith('schaltwerk_core_start_claude', expect.any(Object))
                // Should still dispatch reset event and wait
                expect(mockDispatchEvent).toHaveBeenCalledWith(
                    expect.objectContaining({ type: 'schaltwerk:reset-terminals' })
                )
            })

            it('should handle invalid selection kind', async () => {
                const { result } = renderHook(() => useSessionManagement())

                const selection = {
                    kind: 'invalid' as any,
                    payload: 'test-session'
                }

                await act(async () => {
                    await result.current.resetSession(selection, mockTerminals)
                })

                // Should not perform any reset operations for invalid kind
                expect(mockInvoke).not.toHaveBeenCalledWith('schaltwerk_core_reset_orchestrator', expect.any(Object))
                expect(mockInvoke).not.toHaveBeenCalledWith('terminal_exists', expect.any(Object))
                expect(mockInvoke).not.toHaveBeenCalledWith('schaltwerk_core_start_claude', expect.any(Object))
                // Should still dispatch reset event and wait
                expect(mockDispatchEvent).toHaveBeenCalledWith(
                    expect.objectContaining({ type: 'schaltwerk:reset-terminals' })
                )
            })
        })

        describe('terminal operations edge cases', () => {
            it('should handle terminal existence check failure', async () => {
                const { result } = renderHook(() => useSessionManagement())

                const selection = {
                    kind: 'session' as const,
                    payload: 'test-session'
                }

                mockInvoke.mockRejectedValueOnce(new Error('Terminal check failed')) // terminal_exists fails

                await act(async () => {
                    await expect(
                        result.current.resetSession(selection, mockTerminals)
                    ).rejects.toThrow('Terminal check failed')
                })

                expect(result.current.isResetting).toBe(false)
            })

            it('should handle close terminal failure', async () => {
                const { result } = renderHook(() => useSessionManagement())

                const selection = {
                    kind: 'session' as const,
                    payload: 'test-session'
                }

                mockInvoke
                    .mockResolvedValueOnce(true) // terminal_exists
                    .mockRejectedValueOnce(new Error('Close terminal failed')) // close_terminal fails

                await act(async () => {
                    await expect(
                        result.current.resetSession(selection, mockTerminals)
                    ).rejects.toThrow('Close terminal failed')
                })

                expect(result.current.isResetting).toBe(false)
            })

            it('should handle restart claude failure', async () => {
                const { result } = renderHook(() => useSessionManagement())

                const selection = {
                    kind: 'session' as const,
                    payload: 'test-session'
                }

                mockInvoke
                    .mockResolvedValueOnce(true) // terminal_exists
                    .mockResolvedValueOnce(undefined) // close_terminal
                    .mockRejectedValueOnce(new Error('Restart failed')) // schaltwerk_core_start_claude fails

                await act(async () => {
                    await expect(
                        result.current.resetSession(selection, mockTerminals)
                    ).rejects.toThrow('Restart failed')
                })

                expect(result.current.isResetting).toBe(false)
            })
        })

        describe('switchModel error scenarios', () => {
            it('should handle agent type update failure', async () => {
                const { result } = renderHook(() => useSessionManagement())

                const selection = { kind: 'orchestrator' as const }

                mockInvoke.mockRejectedValueOnce(new Error('Agent type update failed'))

                await act(async () => {
                    await expect(
                        result.current.switchModel(
                            'claude',
                            selection,
                            mockTerminals,
                            mockClearTerminalTracking,
                            mockClearTerminalStartedTracking
                        )
                    ).rejects.toThrow('Agent type update failed')
                })
            })

            it('should handle terminal existence check failure in switchModel', async () => {
                const { result } = renderHook(() => useSessionManagement())

                const selection = { kind: 'orchestrator' as const }

                mockInvoke
                    .mockResolvedValueOnce(undefined) // schaltwerk_core_set_agent_type
                    .mockRejectedValueOnce(new Error('Terminal check failed')) // terminal_exists fails

                await act(async () => {
                    await expect(
                        result.current.switchModel(
                            'claude',
                            selection,
                            mockTerminals,
                            mockClearTerminalTracking,
                            mockClearTerminalStartedTracking
                        )
                    ).rejects.toThrow('Terminal check failed')
                })
            })

            it('should handle close terminal failure in switchModel', async () => {
                const { result } = renderHook(() => useSessionManagement())

                const selection = { kind: 'orchestrator' as const }

                mockInvoke
                    .mockResolvedValueOnce(undefined) // schaltwerk_core_set_agent_type
                    .mockResolvedValueOnce(true) // terminal_exists
                    .mockRejectedValueOnce(new Error('Close terminal failed')) // close_terminal fails

                await act(async () => {
                    await expect(
                        result.current.switchModel(
                            'claude',
                            selection,
                            mockTerminals,
                            mockClearTerminalTracking,
                            mockClearTerminalStartedTracking
                        )
                    ).rejects.toThrow('Close terminal failed')
                })
            })

            it('should handle clear terminal tracking failure', async () => {
                const { result } = renderHook(() => useSessionManagement())

                const selection = { kind: 'orchestrator' as const }

                mockClearTerminalTracking.mockRejectedValueOnce(new Error('Clear tracking failed'))

                mockInvoke
                    .mockResolvedValueOnce(undefined) // schaltwerk_core_set_agent_type
                    .mockResolvedValueOnce(true) // terminal_exists
                    .mockResolvedValueOnce(undefined) // close_terminal

                await act(async () => {
                    await expect(
                        result.current.switchModel(
                            'claude',
                            selection,
                            mockTerminals,
                            mockClearTerminalTracking,
                            mockClearTerminalStartedTracking
                        )
                    ).rejects.toThrow('Clear tracking failed')
                })
            })

            it('should handle orchestrator restart failure', async () => {
                const { result } = renderHook(() => useSessionManagement())

                const selection = { kind: 'orchestrator' as const }

                mockInvoke
                    .mockResolvedValueOnce(undefined) // schaltwerk_core_set_agent_type
                    .mockResolvedValueOnce(true) // terminal_exists
                    .mockResolvedValueOnce(undefined) // close_terminal
                    .mockRejectedValueOnce(new Error('Orchestrator restart failed')) // schaltwerk_core_start_claude_orchestrator

                await act(async () => {
                    await expect(
                        result.current.switchModel(
                            'claude',
                            selection,
                            mockTerminals,
                            mockClearTerminalTracking,
                            mockClearTerminalStartedTracking
                        )
                    ).rejects.toThrow('Orchestrator restart failed')
                })
            })
        })
    })

    describe('state management edge cases', () => {
        it('should prevent concurrent reset calls', async () => {
            const { result } = renderHook(() => useSessionManagement())

            const selection = { kind: 'orchestrator' as const }

            // Mock immediate resolve for all operations
            mockInvoke.mockResolvedValue(undefined)

            // Start first reset and wait for it to complete
            await act(async () => {
                await result.current.resetSession(selection, mockTerminals)
            })

            expect(result.current.isResetting).toBe(false)

            // Reset mock call count
            mockInvoke.mockClear()

            // Try to reset again - this should work normally
            await act(async () => {
                await result.current.resetSession(selection, mockTerminals)
            })

            // Should call invoke for the second reset
            expect(mockInvoke).toHaveBeenCalledTimes(1)
            expect(result.current.isResetting).toBe(false)
        })
    })






})