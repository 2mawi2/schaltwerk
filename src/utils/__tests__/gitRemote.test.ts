import { describe, expect, it } from 'vitest'
import { extractRepoNameFromPath, parseGitRemote, sanitizeFolderName } from '../gitRemote'

describe('gitRemote utils', () => {
  it('extracts repo name from https path', () => {
    expect(extractRepoNameFromPath('org/repo.git')).toBe('repo')
    expect(extractRepoNameFromPath('/org/sub/repo/')).toBe('repo')
  })

  it('returns null for empty paths', () => {
    expect(extractRepoNameFromPath('')).toBeNull()
    expect(extractRepoNameFromPath('/')).toBeNull()
  })

  it('sanitizes folder names', () => {
    expect(sanitizeFolderName('my<repo>')).toBe('myrepo')
  })

  it('parses https remotes', () => {
    const parsed = parseGitRemote('https://github.com/org/repo.git')
    expect(parsed).toEqual({ isValid: true, kind: 'https', repoName: 'repo' })
  })

  it('parses ssh remotes', () => {
    const parsed = parseGitRemote('git@github.com:org/repo.git')
    expect(parsed).toEqual({ isValid: true, kind: 'ssh', repoName: 'repo' })
  })

  it('handles invalid remotes', () => {
    expect(parseGitRemote('not a url')).toEqual({ isValid: false, kind: null, repoName: null })
  })
})
