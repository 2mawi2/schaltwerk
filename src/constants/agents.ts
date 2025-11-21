import type { AgentType } from '../types/session'

export const DEFAULT_AGENT: AgentType = 'claude'

export const MCP_SUPPORTED_AGENTS: readonly AgentType[] = [
  'claude',
  'codex',
  'opencode',
  'amp',
  'droid'
] as const

export const AGENT_COLORS: Record<AgentType, 'blue' | 'green' | 'orange' | 'violet' | 'red' | 'yellow'> = {
  claude: 'blue',
  opencode: 'green',
  gemini: 'orange',
  droid: 'violet',
  codex: 'red',
  amp: 'yellow',
  copilot: 'blue',
  qwen: 'violet',
  terminal: 'blue'
}
