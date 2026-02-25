import { describe, it, expect } from 'vitest'
import { createStore } from 'jotai'
import {
    agentTabsStateAtom,
    AgentTab,
    AgentTabsState,
    DEFAULT_AGENT_TAB_LABEL,
    MAX_AGENT_TABS,
    getAgentTabTerminalId,
    clearAgentTabsForSessionsActionAtom,
} from './agentTabs'

describe('agentTabs atom', () => {
    describe('agentTabsStateAtom', () => {
        it('initializes with an empty map', () => {
            const store = createStore()
            const state = store.get(agentTabsStateAtom)
            expect(state).toBeInstanceOf(Map)
            expect(state.size).toBe(0)
        })

        it('can store and retrieve session tab states', () => {
            const store = createStore()
            const sessionId = 'test-session'
            const tabs: AgentTab[] = [
                { id: 'tab-0', terminalId: 'term-0', label: 'Claude', agentType: 'claude' },
            ]
            const tabsState: AgentTabsState = { tabs, activeTab: 0 }

            store.set(agentTabsStateAtom, new Map([[sessionId, tabsState]]))

            const retrieved = store.get(agentTabsStateAtom)
            expect(retrieved.get(sessionId)).toEqual(tabsState)
        })

        it('can store multiple sessions independently', () => {
            const store = createStore()
            const session1 = 'session-1'
            const session2 = 'session-2'
            const tabs1: AgentTab[] = [{ id: 'tab-0', terminalId: 'term-1-0', label: 'Claude', agentType: 'claude' }]
            const tabs2: AgentTab[] = [{ id: 'tab-0', terminalId: 'term-2-0', label: 'Codex', agentType: 'codex' }]

            const state = new Map<string, AgentTabsState>([
                [session1, { tabs: tabs1, activeTab: 0 }],
                [session2, { tabs: tabs2, activeTab: 0 }],
            ])
            store.set(agentTabsStateAtom, state)

            const retrieved = store.get(agentTabsStateAtom)
            expect(retrieved.get(session1)?.tabs[0].agentType).toBe('claude')
            expect(retrieved.get(session2)?.tabs[0].agentType).toBe('codex')
        })
    })

    describe('constants', () => {
        it('DEFAULT_AGENT_TAB_LABEL is "Agent"', () => {
            expect(DEFAULT_AGENT_TAB_LABEL).toBe('Agent')
        })

        it('MAX_AGENT_TABS is 6', () => {
            expect(MAX_AGENT_TABS).toBe(6)
        })
    })

    describe('getAgentTabTerminalId', () => {
        it('returns base id for index 0', () => {
            expect(getAgentTabTerminalId('session-top', 0)).toBe('session-top')
        })

        it('returns suffixed id for index > 0', () => {
            expect(getAgentTabTerminalId('session-top', 1)).toBe('session-top-1')
            expect(getAgentTabTerminalId('session-top', 2)).toBe('session-top-2')
            expect(getAgentTabTerminalId('session-top', 5)).toBe('session-top-5')
        })
    })

    describe('clearAgentTabsForSessionsActionAtom', () => {
        it('clears agent tabs for specified sessions', () => {
            const store = createStore()
            const session1 = 'session-1'
            const session2 = 'session-2'
            const session3 = 'session-3'
            const tabs1: AgentTab[] = [{ id: 'tab-0', terminalId: 'term-1-0', label: 'Claude', agentType: 'claude' }]
            const tabs2: AgentTab[] = [{ id: 'tab-0', terminalId: 'term-2-0', label: 'Codex', agentType: 'codex' }]
            const tabs3: AgentTab[] = [{ id: 'tab-0', terminalId: 'term-3-0', label: 'Gemini', agentType: 'gemini' }]

            // Set up initial state with 3 sessions
            store.set(agentTabsStateAtom, new Map([
                [session1, { tabs: tabs1, activeTab: 0 }],
                [session2, { tabs: tabs2, activeTab: 0 }],
                [session3, { tabs: tabs3, activeTab: 0 }],
            ]))

            // Clear sessions 1 and 2
            store.set(clearAgentTabsForSessionsActionAtom, [session1, session2])

            const state = store.get(agentTabsStateAtom)
            expect(state.size).toBe(1)
            expect(state.has(session1)).toBe(false)
            expect(state.has(session2)).toBe(false)
            expect(state.has(session3)).toBe(true)
        })

        it('does nothing when clearing non-existent sessions', () => {
            const store = createStore()
            const session1 = 'session-1'
            const tabs1: AgentTab[] = [{ id: 'tab-0', terminalId: 'term-1-0', label: 'Claude', agentType: 'claude' }]

            store.set(agentTabsStateAtom, new Map([[session1, { tabs: tabs1, activeTab: 0 }]]))

            // Clear a session that doesn't exist
            store.set(clearAgentTabsForSessionsActionAtom, ['non-existent-session'])

            const state = store.get(agentTabsStateAtom)
            expect(state.size).toBe(1)
            expect(state.has(session1)).toBe(true)
        })

        it('handles empty array gracefully', () => {
            const store = createStore()
            const session1 = 'session-1'
            const tabs1: AgentTab[] = [{ id: 'tab-0', terminalId: 'term-1-0', label: 'Claude', agentType: 'claude' }]

            store.set(agentTabsStateAtom, new Map([[session1, { tabs: tabs1, activeTab: 0 }]]))

            // Clear with empty array
            store.set(clearAgentTabsForSessionsActionAtom, [])

            const state = store.get(agentTabsStateAtom)
            expect(state.size).toBe(1)
            expect(state.has(session1)).toBe(true)
        })

        it('clears all sessions when all are specified', () => {
            const store = createStore()
            const session1 = 'session-1'
            const session2 = 'session-2'
            const tabs1: AgentTab[] = [{ id: 'tab-0', terminalId: 'term-1-0', label: 'Claude', agentType: 'claude' }]
            const tabs2: AgentTab[] = [{ id: 'tab-0', terminalId: 'term-2-0', label: 'Codex', agentType: 'codex' }]

            store.set(agentTabsStateAtom, new Map([
                [session1, { tabs: tabs1, activeTab: 0 }],
                [session2, { tabs: tabs2, activeTab: 0 }],
            ]))

            // Clear all sessions
            store.set(clearAgentTabsForSessionsActionAtom, [session1, session2])

            const state = store.get(agentTabsStateAtom)
            expect(state.size).toBe(0)
        })
    })
})
