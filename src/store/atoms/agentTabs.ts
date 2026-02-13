import { atom } from 'jotai'
import { AgentType } from '../../types/session'

export type AgentTab = {
    id: string
    terminalId: string
    label: string
    agentType: AgentType
}

export type AgentTabsState = {
    tabs: AgentTab[]
    activeTab: number
}

export const agentTabsStateAtom = atom<Map<string, AgentTabsState>>(new Map())

export const DEFAULT_AGENT_TAB_LABEL = 'Agent'
export const MAX_AGENT_TABS = 6

export const getAgentTabTerminalId = (baseId: string, index: number): string => {
    if (index === 0) return baseId
    return `${baseId}-${index}`
}

/**
 * Action atom to clear agent tabs state for removed sessions.
 * This should be called when sessions are removed to prevent ghost tabs.
 */
export const clearAgentTabsForSessionsActionAtom = atom(
    null,
    (_get, set, sessionIds: string[]) => {
        if (!sessionIds || sessionIds.length === 0) return

        set(agentTabsStateAtom, (prev) => {
            let changed = false
            const next = new Map(prev)
            for (const sessionId of sessionIds) {
                if (next.has(sessionId)) {
                    next.delete(sessionId)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }
)
