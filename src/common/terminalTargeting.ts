export type AgentTabsStateLike = {
  tabs: Array<{ terminalId: string }>
  activeTab: number
}

const activeAgentTerminalIdBySession = new Map<string, string>()

export function setActiveAgentTerminalId(sessionId: string, terminalId: string): void {
  if (!sessionId || !terminalId) return
  activeAgentTerminalIdBySession.set(sessionId, terminalId)
}

export function clearActiveAgentTerminalId(sessionId: string): void {
  if (!sessionId) return
  activeAgentTerminalIdBySession.delete(sessionId)
}

export function getActiveAgentTerminalId(sessionId: string): string | null {
  if (!sessionId) return null
  return activeAgentTerminalIdBySession.get(sessionId) ?? null
}

export function setActiveAgentTerminalFromTabsState(
  sessionId: string,
  state: AgentTabsStateLike | null | undefined,
  fallbackTerminalId: string,
): void {
  setActiveAgentTerminalId(sessionId, resolveActiveAgentTerminalId(state, fallbackTerminalId))
}

export function resolveActiveAgentTerminalId(
  state: AgentTabsStateLike | null | undefined,
  fallbackTerminalId: string,
): string {
  if (!state || state.tabs.length === 0) {
    return fallbackTerminalId
  }

  const active = state.tabs[state.activeTab]
  if (active?.terminalId) {
    return active.terminalId
  }

  return state.tabs[0]?.terminalId ?? fallbackTerminalId
}

export function __resetTerminalTargetingForTest(): void {
  activeAgentTerminalIdBySession.clear()
}
