import { describe, expect, it } from 'vitest'
import { computeProjectId, DEFAULT_PROJECT_ID } from './projectId'

describe('computeProjectId', () => {
  it('returns default identifier when path is missing', () => {
    expect(computeProjectId(null)).toBe(DEFAULT_PROJECT_ID)
    expect(computeProjectId(undefined)).toBe(DEFAULT_PROJECT_ID)
  })

  it('hashes the full path and uses sanitized directory name', () => {
    expect(computeProjectId('/Users/test/projects/alpha')).toBe('alpha-162b7l')
    expect(computeProjectId('/projects/beta')).toBe('beta-1u9vua')
  })

  it('replaces unsupported characters in directory name', () => {
    expect(computeProjectId('/tmp/My Project 🚀/gamma')).toMatch(/^gamma-[0-9a-z]{6}$/)
  })
})
