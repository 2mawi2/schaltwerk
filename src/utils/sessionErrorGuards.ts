const SESSION_MISSING_SNIPPETS = [
  'failed to get session',
  'session not found',
  'query returned no rows',
  'worktree missing',
  'missing worktree',
  'session was not being watched'
]

function toMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'object' && error !== null) {
    const scoped = error as { message?: unknown; error?: unknown }
    if (typeof scoped.message === 'string' && scoped.message) {
      return scoped.message
    }
    if (typeof scoped.error === 'string' && scoped.error) {
      return scoped.error
    }
  }
  try {
    return String(error)
  } catch {
    return ''
  }
}

export function isSessionMissingError(error: unknown): boolean {
  const message = toMessage(error)
  if (!message) {
    return false
  }
  const normalized = message.toLowerCase()
  if (SESSION_MISSING_SNIPPETS.some(snippet => normalized.includes(snippet))) {
    return true
  }
  const sessionNotFoundPattern = /session\s+['"][^"'`]+['"]?\s+not\s+found/
  if (sessionNotFoundPattern.test(normalized)) {
    return true
  }
  if (normalized.includes('session') && normalized.includes('not found')) {
    return true
  }
  return false
}
