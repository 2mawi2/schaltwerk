import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { AgentType, AGENT_TYPES } from '../types/session'
import { DEFAULT_AGENT } from '../constants/agents'

export interface PersistedSessionDefaults {
  baseBranch: string
  agentType: AgentType
  skipPermissions: boolean
}

export async function getPersistedSessionDefaults(): Promise<PersistedSessionDefaults> {
  try {
    const [savedDefaultBranch, gitDefaultBranch, storedSkipPerms, storedAgentType] = await Promise.all([
      invoke<string | null>(TauriCommands.GetProjectDefaultBaseBranch),
      invoke<string>(TauriCommands.GetProjectDefaultBranch),
      invoke<boolean>(TauriCommands.SchaltwerkCoreGetSkipPermissions),
      invoke<string>(TauriCommands.SchaltwerkCoreGetAgentType)
    ])

    const defaultBranch = savedDefaultBranch || gitDefaultBranch || ''
    // Narrow agent type to known values; fallback to default
    const normalizedAgentType = (storedAgentType || DEFAULT_AGENT).toLowerCase()
    const agentType = AGENT_TYPES.includes(normalizedAgentType as AgentType) ? (normalizedAgentType as AgentType) : DEFAULT_AGENT

    return {
      baseBranch: defaultBranch,
      agentType,
      skipPermissions: !!storedSkipPerms,
    }
  } catch (_e) {
    return { baseBranch: '', agentType: DEFAULT_AGENT, skipPermissions: false }
  }
}
