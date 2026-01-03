export function buildSessionScopeId(input: {
  kind: 'orchestrator'
  projectPath: string | null
} | {
  kind: 'session'
  projectPath: string | null
  sessionId: string | null | undefined
}): string {
  const projectKey = input.projectPath ?? 'no-project'

  if (input.kind === 'orchestrator') {
    return `orchestrator:${projectKey}`
  }

  const sessionKey = input.sessionId ?? 'unknown'
  return `session:${projectKey}:${sessionKey}`
}

