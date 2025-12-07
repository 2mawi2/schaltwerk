import { describe, it, expect } from 'vitest'
import { sanitizeName, validateDisplayName } from './sanitizeName'

describe('sanitizeName', () => {
  it('converts to lowercase', () => {
    expect(sanitizeName('HelloWorld')).toBe('helloworld')
  })

  it('replaces spaces with hyphens', () => {
    expect(sanitizeName('hello world')).toBe('hello-world')
  })

  it('replaces special characters with hyphens', () => {
    expect(sanitizeName('hello@world!')).toBe('hello-world')
  })

  it('collapses consecutive hyphens', () => {
    expect(sanitizeName('hello---world')).toBe('hello-world')
    expect(sanitizeName('hello   world')).toBe('hello-world')
    expect(sanitizeName('hello@#$world')).toBe('hello-world')
  })

  it('trims hyphens from start and end', () => {
    expect(sanitizeName('-hello-')).toBe('hello')
    expect(sanitizeName('---hello---')).toBe('hello')
    expect(sanitizeName('  hello  ')).toBe('hello')
  })

  it('limits to 30 characters', () => {
    const longName = 'a'.repeat(50)
    expect(sanitizeName(longName)).toBe('a'.repeat(30))
  })

  it('handles only special characters', () => {
    expect(sanitizeName('!!')).toBe('')
    expect(sanitizeName('@#$%')).toBe('')
    expect(sanitizeName('   ')).toBe('')
  })

  it('preserves numbers', () => {
    expect(sanitizeName('test123')).toBe('test123')
    expect(sanitizeName('123test')).toBe('123test')
  })

  it('handles mixed input', () => {
    expect(sanitizeName('My Test Session #1')).toBe('my-test-session-1')
    expect(sanitizeName('Feature: Add Login')).toBe('feature-add-login')
  })

  it('handles already valid names', () => {
    expect(sanitizeName('already-valid-name')).toBe('already-valid-name')
  })
})

describe('validateDisplayName', () => {
  it('returns null for valid names', () => {
    expect(validateDisplayName('hello')).toBeNull()
    expect(validateDisplayName('hello world')).toBeNull()
    expect(validateDisplayName('test-123')).toBeNull()
  })

  it('returns error for empty string', () => {
    expect(validateDisplayName('')).toBe('Name cannot be empty')
  })

  it('returns error for whitespace only', () => {
    expect(validateDisplayName('   ')).toBe('Name cannot be empty')
  })

  it('returns error for special characters only', () => {
    expect(validateDisplayName('!!')).toBe('Name must contain at least one letter or number')
    expect(validateDisplayName('@#$%')).toBe('Name must contain at least one letter or number')
  })

  it('allows names with some special characters mixed with valid chars', () => {
    expect(validateDisplayName('test!')).toBeNull()
    expect(validateDisplayName('!!test')).toBeNull()
  })

  it('trims input before validation', () => {
    expect(validateDisplayName('  hello  ')).toBeNull()
  })
})
