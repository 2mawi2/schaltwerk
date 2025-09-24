import { AgentType } from '../../types/session'

export type AgentEnvVar = { key: string; value: string }

export type AgentEnvVarState = Record<AgentType, AgentEnvVar[]>

export type AgentCliArgsState = Record<AgentType, string>

export const createEmptyEnvVarState = (): AgentEnvVarState => ({
    claude: [],
    opencode: [],
    gemini: [],
    codex: [],
})

export const createEmptyCliArgsState = (): AgentCliArgsState => ({
    claude: '',
    opencode: '',
    gemini: '',
    codex: '',
})

export const displayNameForAgent = (agent: AgentType) => {
    switch (agent) {
        case 'opencode':
            return 'OpenCode'
        case 'gemini':
            return 'Gemini'
        case 'codex':
            return 'Codex'
        default:
            return 'Claude'
    }
}
