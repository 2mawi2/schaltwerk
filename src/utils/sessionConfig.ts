import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'

export type AgentType = 'claude' | 'cursor' | 'opencode' | 'gemini' | 'qwen' | 'codex'

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
    // Narrow agent type to known values; fallback to 'claude'
    const at = (storedAgentType || 'claude').toLowerCase() as AgentType

    return {
      baseBranch: defaultBranch,
      agentType: (['claude','cursor','opencode','gemini','qwen','codex'].includes(at) ? at : 'claude') as AgentType,
      skipPermissions: !!storedSkipPerms,
    }
  } catch (_e) {
    return { baseBranch: '', agentType: 'claude', skipPermissions: false }
  }
}

