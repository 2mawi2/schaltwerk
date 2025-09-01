import { invoke } from '@tauri-apps/api/core'

export type AgentType = 'claude' | 'cursor' | 'opencode' | 'gemini' | 'qwen' | 'codex'

export interface PersistedSessionDefaults {
  baseBranch: string
  agentType: AgentType
  skipPermissions: boolean
}

export async function getPersistedSessionDefaults(): Promise<PersistedSessionDefaults> {
  try {
    const [savedDefaultBranch, gitDefaultBranch, storedSkipPerms, storedAgentType] = await Promise.all([
      invoke<string | null>('get_project_default_base_branch'),
      invoke<string>('get_project_default_branch'),
      invoke<boolean>('schaltwerk_core_get_skip_permissions'),
      invoke<string>('schaltwerk_core_get_agent_type')
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

