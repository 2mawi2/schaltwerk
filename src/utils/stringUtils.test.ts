import { describe, it, expect } from 'vitest'
import { getLongestCommonPrefix } from './stringUtils'

describe('getLongestCommonPrefix', () => {
  it('returns empty string for empty array', () => {
    expect(getLongestCommonPrefix([])).toBe('')
  })

  it('returns the string itself for single element array', () => {
    expect(getLongestCommonPrefix(['hello'])).toBe('hello')
    expect(getLongestCommonPrefix([''])).toBe('')
    expect(getLongestCommonPrefix(['single'])).toBe('single')
  })

  it('returns empty string when no common prefix exists', () => {
    expect(getLongestCommonPrefix(['abc', 'def'])).toBe('')
    expect(getLongestCommonPrefix(['hello', 'world'])).toBe('')
    expect(getLongestCommonPrefix(['123', '456'])).toBe('')
  })

  it('finds common prefix for identical strings', () => {
    expect(getLongestCommonPrefix(['test', 'test'])).toBe('test')
    expect(getLongestCommonPrefix(['hello', 'hello', 'hello'])).toBe('hello')
  })

  it('finds partial common prefix', () => {
    expect(getLongestCommonPrefix(['hello', 'help'])).toBe('hel')
    expect(getLongestCommonPrefix(['prefix_test', 'prefix_demo'])).toBe('prefix_')
    expect(getLongestCommonPrefix(['abc123', 'abc456'])).toBe('abc')
  })

  it('handles one string being prefix of another', () => {
    expect(getLongestCommonPrefix(['test', 'testing'])).toBe('test')
    expect(getLongestCommonPrefix(['testing', 'test'])).toBe('test')
    expect(getLongestCommonPrefix(['a', 'ab', 'abc'])).toBe('a')
  })

  it('handles complex branch name scenarios', () => {
    expect(getLongestCommonPrefix([
      'feature/PROJ-123-user-auth',
      'feature/PROJ-123-password-reset',
      'feature/PROJ-123-payment-integration'
    ])).toBe('feature/PROJ-123-')

    expect(getLongestCommonPrefix([
      'bugfix/login-validation',
      'bugfix/logout-cleanup',
      'bugfix/session-timeout'
    ])).toBe('bugfix/')

    expect(getLongestCommonPrefix([
      'hotfix/v1.2.3-security-patch',
      'hotfix/v1.2.3-performance-fix'
    ])).toBe('hotfix/v1.2.3-')
  })

  it('handles empty strings in the array', () => {
    expect(getLongestCommonPrefix(['', 'test'])).toBe('')
    expect(getLongestCommonPrefix(['test', ''])).toBe('')
    expect(getLongestCommonPrefix(['', ''])).toBe('')
  })

  it('handles strings with special characters', () => {
    expect(getLongestCommonPrefix(['test_123', 'test_456'])).toBe('test_')
    expect(getLongestCommonPrefix(['feature-branch', 'feature-test'])).toBe('feature-')
    expect(getLongestCommonPrefix(['v1.0.0', 'v1.0.1'])).toBe('v1.0.')
  })

  it('handles case sensitivity', () => {
    expect(getLongestCommonPrefix(['Test', 'test'])).toBe('')
    expect(getLongestCommonPrefix(['TEST', 'TESTING'])).toBe('TEST')
  })

  it('handles very long strings', () => {
    const longString1 = 'a'.repeat(1000) + 'b'
    const longString2 = 'a'.repeat(1000) + 'c'
    expect(getLongestCommonPrefix([longString1, longString2])).toBe('a'.repeat(1000))
  })

  it('handles unicode characters', () => {
    expect(getLongestCommonPrefix(['café', 'café'])).toBe('café')
    expect(getLongestCommonPrefix(['café', 'café-au-lait'])).toBe('café')
    expect(getLongestCommonPrefix(['测试', '测试字符串'])).toBe('测试')
  })
})