import { describe, it, expect } from 'vitest'
import { validateSessionName, normalizeSessionName } from './sessionName'

describe('Session Name Utilities', () => {
  describe('validateSessionName', () => {
    it('should accept valid names with spaces', () => {
      expect(validateSessionName('my session name')).toBeNull()
      expect(validateSessionName('test name with spaces')).toBeNull()
    })

    it('should accept valid names without spaces', () => {
      expect(validateSessionName('my-valid_name123')).toBeNull()
      expect(validateSessionName('test_name')).toBeNull()
    })

    it('should reject special characters', () => {
      expect(validateSessionName('my@session')).toBe('Session name can only contain letters, numbers, hyphens, and underscores')
      expect(validateSessionName('test#name')).toBe('Session name can only contain letters, numbers, hyphens, and underscores')
      expect(validateSessionName('name$with%special')).toBe('Session name can only contain letters, numbers, hyphens, and underscores')
    })

    it('should reject empty names', () => {
      expect(validateSessionName('')).toBe('Session name is required')
      expect(validateSessionName('   ')).toBe('Session name is required')
    })

    it('should reject names that are too long', () => {
      const longName = 'a'.repeat(101)
      expect(validateSessionName(longName)).toBe('Session name must be 100 characters or less')
    })
  })

  describe('normalizeSessionName', () => {
    it('should convert spaces to underscores', () => {
      expect(normalizeSessionName('my session name')).toBe('my_session_name')
      expect(normalizeSessionName('test name')).toBe('test_name')
    })

    it('should preserve multiple spaces as multiple underscores', () => {
      expect(normalizeSessionName('my  spaced   name')).toBe('my__spaced___name')
    })

    it('should trim spaces at beginning and end', () => {
      expect(normalizeSessionName('  my session  ')).toBe('my_session')
      expect(normalizeSessionName(' test ')).toBe('test')
    })

    it('should handle names without spaces', () => {
      expect(normalizeSessionName('my-valid_name123')).toBe('my-valid_name123')
      expect(normalizeSessionName('test_name')).toBe('test_name')
    })

    it('should handle empty strings', () => {
      expect(normalizeSessionName('')).toBe('')
      expect(normalizeSessionName('   ')).toBe('')
    })
  })
})