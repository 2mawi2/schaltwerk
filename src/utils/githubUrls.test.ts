import { describe, it, expect } from 'vitest'
import { buildPrUrl, extractPrNumberFromUrl } from './githubUrls'

describe('githubUrls', () => {
  describe('buildPrUrl', () => {
    it('builds a correct PR URL', () => {
      const result = buildPrUrl('owner/repo', 123)
      expect(result).toBe('https://github.com/owner/repo/pull/123')
    })

    it('handles organization/repo format', () => {
      const result = buildPrUrl('my-org/my-repo', 1)
      expect(result).toBe('https://github.com/my-org/my-repo/pull/1')
    })
  })

  describe('extractPrNumberFromUrl', () => {
    it('extracts PR number from a valid URL', () => {
      const result = extractPrNumberFromUrl('https://github.com/owner/repo/pull/123')
      expect(result).toBe(123)
    })

    it('extracts PR number from URL with hash', () => {
      const result = extractPrNumberFromUrl('https://github.com/owner/repo/pull/456#discussion_r1')
      expect(result).toBe(456)
    })

    it('returns null for non-PR URLs', () => {
      const result = extractPrNumberFromUrl('https://github.com/owner/repo/issues/123')
      expect(result).toBeNull()
    })

    it('returns null for invalid URLs', () => {
      const result = extractPrNumberFromUrl('not a url')
      expect(result).toBeNull()
    })

    it('handles URLs with query params', () => {
      const result = extractPrNumberFromUrl('https://github.com/owner/repo/pull/789?diff=unified')
      expect(result).toBe(789)
    })
  })
})
