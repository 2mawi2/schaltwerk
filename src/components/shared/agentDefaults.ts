import { AgentType, createAgentRecord } from '../../types/session'

export type AgentEnvVar = { key: string; value: string }

export type AgentEnvVarState = Record<AgentType, AgentEnvVar[]>

export type AgentCliArgsState = Record<AgentType, string>

export const createEmptyEnvVarState = (): AgentEnvVarState =>
    createAgentRecord<AgentEnvVar[]>(_agent => [])

export const createEmptyCliArgsState = (): AgentCliArgsState => createAgentRecord(_agent => '')

export const displayNameForAgent = (agent: AgentType) => {
    switch (agent) {
        case 'opencode':
            return 'OpenCode'
        case 'gemini':
            return 'Gemini'
        case 'codex':
            return 'Codex'
        case 'droid':
            return 'Droid'
        case 'qwen':
            return 'Qwen'
        default:
            return 'Claude'
    }
}
