export function validateSessionName(sessionName: string): string | null {
  if (!sessionName.trim()) {
    return 'Session name is required'
  }
  if (sessionName.length > 100) {
    return 'Session name must be 100 characters or less'
  }
  if (!/^[a-zA-Z0-9_ \\-]+$/.test(sessionName)) {
    return 'Session name can only contain letters, numbers, hyphens, and underscores'
  }
  return null
}

export function normalizeSessionName(name: string): string {
  return name.trim().replace(/ /g, '_')
}