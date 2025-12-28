import { describe, it, expect } from 'vitest'
import { fuzzyMatch } from './fuzzyMatch'

describe('fuzzyMatch', () => {
  it('matches exact string', () => {
    expect(fuzzyMatch('hello world', 'hello world')).toBe(true)
  })

  it('matches substring characters in order', () => {
    expect(fuzzyMatch('hello world', 'hlo')).toBe(true)
    expect(fuzzyMatch('hello world', 'hw')).toBe(true)
    expect(fuzzyMatch('hello world', 'helloworld')).toBe(true)
  })

  it('is case insensitive', () => {
    expect(fuzzyMatch('Hello World', 'hello')).toBe(true)
    expect(fuzzyMatch('hello world', 'HELLO')).toBe(true)
    expect(fuzzyMatch('HELLO WORLD', 'hw')).toBe(true)
  })

  it('returns false when characters are out of order', () => {
    expect(fuzzyMatch('hello world', 'wh')).toBe(false)
    expect(fuzzyMatch('abc', 'cba')).toBe(false)
  })

  it('returns false when pattern has characters not in text', () => {
    expect(fuzzyMatch('hello', 'hellox')).toBe(false)
    expect(fuzzyMatch('abc', 'abcd')).toBe(false)
  })

  it('handles empty pattern', () => {
    expect(fuzzyMatch('hello', '')).toBe(true)
  })

  it('handles empty text', () => {
    expect(fuzzyMatch('', 'hello')).toBe(false)
  })

  it('handles both empty', () => {
    expect(fuzzyMatch('', '')).toBe(true)
  })

  it('matches commit-like patterns', () => {
    expect(fuzzyMatch('fix: update authentication logic', 'fix auth')).toBe(true)
    expect(fuzzyMatch('feat(api): add user endpoint', 'api user')).toBe(true)
    expect(fuzzyMatch('abc1234', 'abc')).toBe(true)
    expect(fuzzyMatch('abc1234', '1234')).toBe(true)
  })
})
