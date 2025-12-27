export function projectScopeKey(projectPath: string | null | undefined): string {
  return projectPath ?? 'none'
}

export function scopedTerminalKey(projectPath: string | null | undefined, terminalId: string): string {
  return `${projectScopeKey(projectPath)}::${terminalId}`
}

export function scopedSessionKey(projectPath: string | null | undefined, sessionId: string): string {
  return `${projectScopeKey(projectPath)}::${sessionId}`
}

