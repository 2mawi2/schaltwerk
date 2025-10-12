export type AgentLifecycleState = 'spawned' | 'ready' | 'failed'

export interface AgentLifecycleUpdate {
  terminalId: string
  state: AgentLifecycleState
  agentType?: string | null
  sessionName?: string | null
  whenMs?: number
  reason?: string
}

const AGENT_TYPE_CODEX = 'codex'

export const EXTENDED_AGENT_START_TIMEOUT_MS = 15_000
export const DEFAULT_AGENT_START_TIMEOUT_MS = 5_000

let hasAnyAgentReportedReady = false
let hasCodexReportedReady = false
const activeCodexTerminals = new Set<string>()

function normalizeAgentType(agentType?: string | null): string | null {
  if (!agentType) return null
  return agentType.toLowerCase()
}

export function shouldUseExtendedAgentTimeout(agentType?: string | null): boolean {
  const normalized = normalizeAgentType(agentType)
  if (!hasAnyAgentReportedReady) {
    return true
  }
  if (activeCodexTerminals.size > 0) {
    return true
  }
  if (normalized === AGENT_TYPE_CODEX && !hasCodexReportedReady) {
    return true
  }
  return false
}

export function recordAgentLifecycle(update: AgentLifecycleUpdate): void {
  const normalized = normalizeAgentType(update.agentType)

  switch (update.state) {
    case 'spawned': {
      if (normalized === AGENT_TYPE_CODEX) {
        activeCodexTerminals.add(update.terminalId)
      }
      break
    }
    case 'ready': {
      hasAnyAgentReportedReady = true
      if (normalized === AGENT_TYPE_CODEX) {
        hasCodexReportedReady = true
        activeCodexTerminals.delete(update.terminalId)
      }
      break
    }
    case 'failed': {
      if (normalized === AGENT_TYPE_CODEX) {
        activeCodexTerminals.delete(update.terminalId)
      }
      break
    }
    default: {
      const exhaustive: never = update.state
      throw new Error(`Unhandled agent lifecycle state: ${exhaustive}`)
    }
  }
}

export function resetAgentLifecycleStateForTests(): void {
  hasAnyAgentReportedReady = false
  hasCodexReportedReady = false
  activeCodexTerminals.clear()
}
