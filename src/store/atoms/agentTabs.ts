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
