import { hashSegments } from './hashSegments'

export const DEFAULT_PROJECT_ID = 'default'

export function computeProjectId(projectPath: string | null | undefined): string {
  if (!projectPath) {
    return DEFAULT_PROJECT_ID
  }

  const dirName = projectPath.split(/[/\\]/).pop() || 'unknown'
  const sanitizedDirName = dirName.replace(/[^a-zA-Z0-9_-]/g, '_')

  const hashed = hashSegments([projectPath])
  const suffix = hashed.slice(0, 6).padStart(6, '0')

  return `${sanitizedDirName}-${suffix}`
}
