import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest'
import { TauriCommands } from '../common/tauriCommands'
import { renderHook, act } from '@testing-library/react'
import { useAgentTabs } from './useAgentTabs'
import { invoke } from '@tauri-apps/api/core'
import { ReactNode, createElement } from 'react'
import { Provider } from 'jotai'
import { AgentType } from '../types/session'

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}))

vi.mock('../utils/logger', () => ({
    logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
    },
}))

describe('useAgentTabs', () => {
    const mockInvoke = invoke as MockedFunction<typeof invoke>

    beforeEach(() => {
        vi.clearAllMocks()
        mockInvoke.mockResolvedValue(undefined)
    })

    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(Provider, null, children)

    const renderTabsHook = (sessionId: string | null, baseTerminalId: string | null) =>
        renderHook(() => useAgentTabs(sessionId, baseTerminalId), { wrapper })

    describe('initialization', () => {
        it('initializes with default tab', () => {
            const { result } = renderTabsHook('session-1', 'term-1')

            act(() => {
                result.current.ensureInitialized('claude')
            })

            const state = result.current.getTabsState()
            expect(state).toBeDefined()
            expect(state?.tabs).toHaveLength(1)
            expect(state?.tabs[0]).toMatchObject({
                id: 'tab-0',
                terminalId: 'term-1',
                agentType: 'claude',
            })
            expect(state?.activeTab).toBe(0)
        })

        it('does not reinitialize if already initialized', () => {
            const { result } = renderTabsHook('session-1', 'term-1')

            act(() => {
                result.current.ensureInitialized('claude')
            })

            const state1 = result.current.getTabsState()

            act(() => {
                result.current.ensureInitialized('codex')
            })

            const state2 = result.current.getTabsState()
            expect(state2?.tabs[0].agentType).toBe('claude')
            expect(state1).toEqual(state2)
        })

        it('returns null for null session/terminal', () => {
            const { result } = renderTabsHook(null, null)
            const state = result.current.getTabsState()
            expect(state).toBeNull()
        })
    })

    describe('addTab', () => {
        it('adds new tab and calls backend', async () => {
            const { result } = renderTabsHook('session-1', 'term-1')

            act(() => {
                result.current.ensureInitialized('claude')
            })

            await act(async () => {
                await result.current.addTab('codex')
            })

            const state = result.current.getTabsState()
            expect(state?.tabs).toHaveLength(2)
            expect(state?.tabs[1]).toMatchObject({
                id: 'tab-1',
                terminalId: 'term-1-1',
                agentType: 'codex',
            })
            expect(state?.activeTab).toBe(1)

            expect(mockInvoke).toHaveBeenCalledWith(
                TauriCommands.SchaltwerkCoreStartSessionAgentWithRestart,
                {
                    params: {
                        sessionName: 'session-1',
                        forceRestart: false,
                        terminalId: 'term-1-1',
                        agentType: 'codex',
                        skipPrompt: true,
                    },
                }
            )
        })

        it('passes skipPermissions option to backend', async () => {
            const { result } = renderTabsHook('session-1', 'term-1')

            act(() => {
                result.current.ensureInitialized('claude')
            })

            await act(async () => {
                await result.current.addTab('codex', { skipPermissions: true })
            })

            expect(mockInvoke).toHaveBeenCalledWith(
                TauriCommands.SchaltwerkCoreStartSessionAgentWithRestart,
                {
                    params: {
                        sessionName: 'session-1',
                        forceRestart: false,
                        terminalId: 'term-1-1',
                        agentType: 'codex',
                        skipPrompt: true,
                        skipPermissions: true,
                    },
                }
            )
        })

        it('passes skipPermissions=false when explicitly set', async () => {
            const { result } = renderTabsHook('session-1', 'term-1')

            act(() => {
                result.current.ensureInitialized('claude')
            })

            await act(async () => {
                await result.current.addTab('codex', { skipPermissions: false })
            })

            expect(mockInvoke).toHaveBeenCalledWith(
                TauriCommands.SchaltwerkCoreStartSessionAgentWithRestart,
                {
                    params: {
                        sessionName: 'session-1',
                        forceRestart: false,
                        terminalId: 'term-1-1',
                        agentType: 'codex',
                        skipPrompt: true,
                        skipPermissions: false,
                    },
                }
            )
        })

        it('keeps the first tab agent when defaults change', async () => {
            const { result } = renderTabsHook('session-1', 'term-1')

            act(() => {
                result.current.ensureInitialized('claude')
            })

            act(() => {
                result.current.ensureInitialized('codex' as AgentType)
            })

            await act(async () => {
                await result.current.addTab('codex' as AgentType)
            })

            const state = result.current.getTabsState()
            expect(state?.tabs).toEqual([
                expect.objectContaining({ terminalId: 'term-1', agentType: 'claude' }),
                expect.objectContaining({ terminalId: 'term-1-1', agentType: 'codex' }),
            ])
            expect(state?.activeTab).toBe(1)
        })
    })

    describe('setActiveTab', () => {
        it('changes active tab', async () => {
            const { result } = renderTabsHook('session-1', 'term-1')

            act(() => {
                result.current.ensureInitialized('claude')
            })

            await act(async () => {
                await result.current.addTab('codex')
            })

            act(() => {
                result.current.setActiveTab(0)
            })

            const state = result.current.getTabsState()
            expect(state?.activeTab).toBe(0)
        })
    })

    describe('closeTab', () => {
        it('cannot close the first tab', async () => {
            const { result } = renderTabsHook('session-1', 'term-1')

            act(() => {
                result.current.ensureInitialized('claude')
            })

            await act(async () => {
                await result.current.addTab('codex')
            })

            act(() => {
                result.current.closeTab(0)
            })

            const state = result.current.getTabsState()
            expect(state?.tabs).toHaveLength(2)
        })

        it('closes non-primary tabs and calls backend', async () => {
            const { result } = renderTabsHook('session-1', 'term-1')

            act(() => {
                result.current.ensureInitialized('claude')
            })

            await act(async () => {
                await result.current.addTab('codex')
            })

            mockInvoke.mockClear()

            act(() => {
                result.current.closeTab(1)
            })

            const state = result.current.getTabsState()
            expect(state?.tabs).toHaveLength(1)
            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.CloseTerminal, {
                id: 'term-1-1',
            })
        })

        it('adjusts active tab when closing current tab', async () => {
            const { result } = renderTabsHook('session-1', 'term-1')

            act(() => {
                result.current.ensureInitialized('claude')
            })

            await act(async () => {
                await result.current.addTab('codex')
            })

            expect(result.current.getTabsState()?.activeTab).toBe(1)

            act(() => {
                result.current.closeTab(1)
            })

            expect(result.current.getTabsState()?.activeTab).toBe(0)
        })
    })

    describe('updatePrimaryAgentType', () => {
        it('updates primary tab label when agent type changes', () => {
            const { result } = renderTabsHook('session-1', 'term-1')

            act(() => {
                result.current.ensureInitialized('claude')
            })

            act(() => {
                result.current.updatePrimaryAgentType('codex')
            })

            const state = result.current.getTabsState()
            expect(state?.tabs[0].label.toLowerCase()).toContain('codex')
            expect(state?.tabs[0].agentType).toBe('codex')
        })
    })

    describe('resetTabs', () => {
        it('resets to single tab and closes extra terminals', async () => {
            const { result } = renderTabsHook('session-1', 'term-1')

            act(() => {
                result.current.ensureInitialized('claude')
            })

            await act(async () => {
                await result.current.addTab('codex')
            })

            expect(result.current.getTabsState()?.tabs).toHaveLength(2)

            mockInvoke.mockClear()

            await act(async () => {
                await result.current.resetTabs()
            })

            const state = result.current.getTabsState()
            expect(state?.tabs).toHaveLength(1)
            expect(state?.tabs[0].terminalId).toBe('term-1')

            expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.CloseTerminal, {
                id: 'term-1-1',
            })
        })
    })

    describe('getActiveTerminalId', () => {
        it('returns the terminal id of the active tab', async () => {
            const { result } = renderTabsHook('session-1', 'term-1')

            act(() => {
                result.current.ensureInitialized('claude')
            })

            expect(result.current.getActiveTerminalId()).toBe('term-1')

            await act(async () => {
                await result.current.addTab('codex')
            })

            expect(result.current.getActiveTerminalId()).toBe('term-1-1')

            act(() => {
                result.current.setActiveTab(0)
            })

            expect(result.current.getActiveTerminalId()).toBe('term-1')
        })

        it('returns null when no state', () => {
            const { result } = renderTabsHook(null, null)
            expect(result.current.getActiveTerminalId()).toBeNull()
        })
    })
})
