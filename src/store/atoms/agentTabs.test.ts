import { describe, it, expect } from 'vitest'
import { createStore } from 'jotai'
import {
    agentTabsStateAtom,
    AgentTab,
    AgentTabsState,
    DEFAULT_AGENT_TAB_LABEL,
    MAX_AGENT_TABS,
    getAgentTabTerminalId,
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
})
