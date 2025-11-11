export type GitRemoteKind = 'ssh' | 'https'

export interface ParsedGitRemote {
  isValid: boolean
  kind: GitRemoteKind | null
  repoName: string | null
}

const INVALID_FOLDER_CHARS = /[<>:"|?*\\]/g

export function sanitizeFolderName(value: string): string {
  return value.replace(INVALID_FOLDER_CHARS, '').trim()
}

export function extractRepoNameFromPath(path: string): string | null {
  const normalized = path
    .replace(/\.git$/i, '')
    .replace(/\\+/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/g, '')

  if (!normalized) {
    return null
  }

  const segments = normalized.split('/').filter(Boolean)
  if (!segments.length) {
    return null
  }

  return segments[segments.length - 1]
}

export function parseGitRemote(value: string): ParsedGitRemote {
  const trimmed = value.trim()
  if (!trimmed) {
    return { isValid: false, kind: null, repoName: null }
  }

  const httpsMatch = /^https?:\/\/([^@]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(trimmed)
  if (httpsMatch) {
    const repoName = extractRepoNameFromPath(httpsMatch[3])
    return { isValid: Boolean(repoName), kind: 'https', repoName }
  }

  const sshMatch = /^(?:ssh:\/\/)?([^@/\s]+)@([^:/\s]+)(?::\d+)?[/:](.+)$/.exec(trimmed)
  if (sshMatch) {
    const repoName = extractRepoNameFromPath(sshMatch[3])
    return { isValid: Boolean(repoName), kind: 'ssh', repoName }
  }

  return { isValid: false, kind: null, repoName: null }
}
