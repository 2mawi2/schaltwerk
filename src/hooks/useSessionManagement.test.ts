import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriCommands } from '../common/tauriCommands'
import { renderHook, act } from '@testing-library/react'
import { useSessionManagement } from './useSessionManagement'
import { invoke } from '@tauri-apps/api/core'
import * as TauriEvent from '@tauri-apps/api/event'
import { UiEvent } from '../common/uiEvents'

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn()
}))

const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

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
        dispatchSpy.mockClear()
        mockInvoke.mockResolvedValue(true)
    })

    afterAll(() => {
        dispatchSpy.mockRestore()
    })

    describe('resetSession', () => {
        it('should reset orchestrator session', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'orchestrator' as const }

            await act(async () => {
                // Emit lifecycle events deterministically as the hook now awaits them
                setTimeout(() => {
                    const tev = TauriEvent as unknown as { __emit: (event: string, payload: unknown) => void }
                    tev.__emit('schaltwerk:terminal-closed', { terminal_id: 'test-terminal-top' })
                    tev.__emit('schaltwerk:terminal-agent-started', { terminal_id: 'test-terminal-top' })
                })
                await result.current.resetSession(selection, mockTerminals)
            })

            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreResetOrchestrator, {
                terminalId: 'test-terminal-top'
            })
            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: String(UiEvent.TerminalReset),
                    detail: { kind: 'orchestrator' },
                })
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
                .mockImplementationOnce(async () => { // close_terminal
                    const tev = TauriEvent as unknown as { __emit: (event: string, payload: unknown) => void }
                    tev.__emit('schaltwerk:terminal-closed', { terminal_id: 'test-terminal-top' })
                    return undefined
                })
                .mockImplementationOnce(async () => { // schaltwerk_core_start_claude
                    const tev = TauriEvent as unknown as { __emit: (event: string, payload: unknown) => void }
                    tev.__emit('schaltwerk:terminal-agent-started', { terminal_id: 'test-terminal-top' })
                    return undefined
                })

            await act(async () => {
                await result.current.resetSession(selection, mockTerminals)
            })

            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.TerminalExists, {
                id: 'test-terminal-top'
            })
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.CloseTerminal, {
                id: 'test-terminal-top'
            })
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartClaudeWithRestart, {
                sessionName: 'test-session',
                forceRestart: true
            })
            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: String(UiEvent.TerminalReset),
                    detail: { kind: 'session', sessionId: 'test-session' },
                })
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
                .mockImplementationOnce(async () => { // schaltwerk_core_start_claude
                    const tev = TauriEvent as unknown as { __emit: (event: string, payload: unknown) => void }
                    tev.__emit('schaltwerk:terminal-agent-started', { terminal_id: 'test-terminal-top' })
                    return undefined
                })

            await act(async () => {
                await result.current.resetSession(selection, mockTerminals)
            })

            expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.CloseTerminal, expect.any(Object))
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartClaudeWithRestart, {
                sessionName: 'test-session',
                forceRestart: true
            })
        })

        it('should track resetting state', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'orchestrator' as const }

            expect(result.current.isResetting).toBe(false)

            const resetPromise = act(async () => {
                setTimeout(() => {
                    const tev = TauriEvent as unknown as { __emit: (event: string, payload: unknown) => void }
                    tev.__emit('schaltwerk:terminal-closed', { terminal_id: 'test-terminal-top' })
                    tev.__emit('schaltwerk:terminal-agent-started', { terminal_id: 'test-terminal-top' })
                })
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
                .mockResolvedValueOnce(undefined) // schaltwerk_core_set_skip_permissions
                .mockResolvedValueOnce(undefined) // schaltwerk_core_set_agent_type
                .mockResolvedValueOnce(true) // terminal_exists
                .mockImplementationOnce(async () => { // close_terminal
                    const tev = TauriEvent as unknown as { __emit: (event: string, payload: unknown) => void }
                    tev.__emit('schaltwerk:terminal-closed', { terminal_id: 'test-terminal-top' })
                    return undefined
                })
                .mockImplementationOnce(async () => { // schaltwerk_core_start_claude_orchestrator
                    const tev = TauriEvent as unknown as { __emit: (event: string, payload: unknown) => void }
                    tev.__emit('schaltwerk:terminal-agent-started', { terminal_id: 'test-terminal-top' })
                    return undefined
                })

            expect(result.current).not.toBeNull()
            
            await act(async () => {
                await result.current!.switchModel(
                    'gemini',
                    true,
                    selection, 
                    mockTerminals,
                    mockClearTerminalTracking,
                    mockClearTerminalStartedTracking
                )
            })

            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetSkipPermissions, {
                enabled: true
            })
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetAgentType, {
                agentType: 'gemini'
            })
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartClaudeOrchestrator, {
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
                .mockResolvedValueOnce(undefined) // schaltwerk_core_set_skip_permissions
                .mockResolvedValueOnce(undefined) // schaltwerk_core_set_session_agent_type
                .mockResolvedValueOnce(true) // terminal_exists
                .mockImplementationOnce(async () => { // close_terminal
                    const tev = TauriEvent as unknown as { __emit: (event: string, payload: unknown) => void }
                    tev.__emit('schaltwerk:terminal-closed', { terminal_id: 'test-terminal-top' })
                    return undefined
                })
                .mockImplementationOnce(async () => { // schaltwerk_core_start_claude
                    const tev = TauriEvent as unknown as { __emit: (event: string, payload: unknown) => void }
                    tev.__emit('schaltwerk:terminal-agent-started', { terminal_id: 'test-terminal-top' })
                    return undefined
                })

            await act(async () => {
                await result.current!.switchModel(
                    'opencode',
                    false,
                    selection, 
                    mockTerminals,
                    mockClearTerminalTracking,
                    mockClearTerminalStartedTracking
                )
            })

            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetSkipPermissions, {
                enabled: false
            })
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetSessionAgentType, {
                sessionName: 'test-session',
                agentType: 'opencode'
            })
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartClaudeWithRestart, {
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
                .mockResolvedValueOnce(undefined) // schaltwerk_core_set_skip_permissions
                .mockResolvedValueOnce(undefined) // schaltwerk_core_set_agent_type
                .mockResolvedValueOnce(false) // terminal_exists returns false
                .mockResolvedValueOnce(undefined) // schaltwerk_core_start_claude_orchestrator

            await act(async () => {
                await result.current!.switchModel(
                    'claude',
                    false,
                    selection, 
                    mockTerminals,
                    mockClearTerminalTracking,
                    mockClearTerminalStartedTracking
                )
            })

            expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.CloseTerminal, expect.any(Object))
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetSkipPermissions, {
                enabled: false
            })
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartClaudeOrchestrator, {
                terminalId: 'test-terminal-top'
            })
        })

        it('should dispatch reset terminals event after model switch', async () => {
            const { result } = renderHook(() => useSessionManagement())
            
            const selection = { kind: 'orchestrator' as const }

            await act(async () => {
                await result.current!.switchModel(
                    'opencode',
                    false,
                    selection, 
                    mockTerminals,
                    mockClearTerminalTracking,
                    mockClearTerminalStartedTracking
                )
            })

            expect(dispatchSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: String(UiEvent.TerminalReset),
                    detail: { kind: 'orchestrator' },
                })
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
                        false,
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
                    payload: null as unknown as string
                }

                await act(async () => {
                    await result.current.resetSession(selection, mockTerminals)
                })

                // Should not call any commands when payload is null
                expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreResetOrchestrator, expect.any(Object))
                expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.TerminalExists, expect.any(Object))
                expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartClaude, expect.any(Object))
                // Should still dispatch reset event and wait
                expect(dispatchSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: String(UiEvent.TerminalReset),
                        detail: { kind: 'orchestrator' },
                    })
                )
            })

            it('should handle session with undefined payload', async () => {
                const { result } = renderHook(() => useSessionManagement())

                const selection = {
                    kind: 'session' as const,
                    payload: undefined as unknown as string
                }

                await act(async () => {
                    await result.current.resetSession(selection, mockTerminals)
                })

                // Should not call any commands when payload is undefined
                expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreResetOrchestrator, expect.any(Object))
                expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.TerminalExists, expect.any(Object))
                expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartClaude, expect.any(Object))
                // Should still dispatch reset event and wait
                expect(dispatchSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: String(UiEvent.TerminalReset),
                        detail: { kind: 'orchestrator' },
                    })
                )
            })

            it('should handle invalid selection kind', async () => {
                const { result } = renderHook(() => useSessionManagement())

                const selection = {
                    kind: 'invalid' as unknown as 'orchestrator' | 'session',
                    payload: 'test-session'
                }

                await act(async () => {
                    await result.current.resetSession(selection, mockTerminals)
                })

                // Should not perform any reset operations for invalid kind
                expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreResetOrchestrator, expect.any(Object))
                expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.TerminalExists, expect.any(Object))
                expect(mockInvoke).not.toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartClaude, expect.any(Object))
                // Should still dispatch reset event and wait
                expect(dispatchSpy).toHaveBeenCalledWith(
                    expect.objectContaining({
                        type: String(UiEvent.TerminalReset),
                        detail: { kind: 'orchestrator' },
                    })
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

                mockInvoke
                    .mockResolvedValueOnce(undefined) // schaltwerk_core_set_skip_permissions
                    .mockRejectedValueOnce(new Error('Agent type update failed'))

                await act(async () => {
                    await expect(
                        result.current.switchModel(
                            'claude',
                            false,
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
                    .mockResolvedValueOnce(undefined) // schaltwerk_core_set_skip_permissions
                    .mockResolvedValueOnce(undefined) // schaltwerk_core_set_agent_type
                    .mockRejectedValueOnce(new Error('Terminal check failed')) // terminal_exists fails

                await act(async () => {
                    await expect(
                        result.current.switchModel(
                            'claude',
                            false,
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
                    .mockResolvedValueOnce(undefined) // schaltwerk_core_set_skip_permissions
                    .mockResolvedValueOnce(undefined) // schaltwerk_core_set_agent_type
                    .mockResolvedValueOnce(true) // terminal_exists
                    .mockRejectedValueOnce(new Error('Close terminal failed')) // close_terminal fails

                await act(async () => {
                    await expect(
                        result.current.switchModel(
                            'claude',
                            false,
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
                    .mockResolvedValueOnce(undefined) // schaltwerk_core_set_skip_permissions
                    .mockResolvedValueOnce(undefined) // schaltwerk_core_set_agent_type
                    .mockResolvedValueOnce(true) // terminal_exists
                    .mockResolvedValueOnce(undefined) // close_terminal

                await act(async () => {
                    await expect(
                        result.current.switchModel(
                            'claude',
                            false,
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
                    .mockResolvedValueOnce(undefined) // schaltwerk_core_set_skip_permissions
                    .mockResolvedValueOnce(undefined) // schaltwerk_core_set_agent_type
                    .mockResolvedValueOnce(true) // terminal_exists
                    .mockResolvedValueOnce(undefined) // close_terminal
                    .mockRejectedValueOnce(new Error('Orchestrator restart failed')) // schaltwerk_core_start_claude_orchestrator

                await act(async () => {
                    await expect(
                        result.current.switchModel(
                            'claude',
                            false,
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
