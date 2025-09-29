import { describe, expect, it, vi } from 'vitest'
import { formatDateTime, normalizeDateInput } from './dateTime'

describe('normalizeDateInput', () => {
  it('returns a Date for ISO strings', () => {
    const result = normalizeDateInput('2024-01-15T12:30:00Z')
    expect(result).toBeInstanceOf(Date)
    expect(result?.toISOString()).toBe('2024-01-15T12:30:00.000Z')
  })

  it('handles unix timestamps provided in seconds', () => {
    const seconds = 1_700_000_000
    const result = normalizeDateInput(seconds)
    expect(result).toBeInstanceOf(Date)
    expect(result?.getTime()).toBe(seconds * 1000)
  })

  it('handles unix timestamps provided in milliseconds', () => {
    const milliseconds = 1_700_000_000_000
    const result = normalizeDateInput(milliseconds)
    expect(result).toBeInstanceOf(Date)
    expect(result?.getTime()).toBe(milliseconds)
  })

  it('returns null for invalid values', () => {
    expect(normalizeDateInput('')).toBeNull()
    expect(normalizeDateInput('not-a-date')).toBeNull()
    expect(normalizeDateInput(Number.NaN)).toBeNull()
    expect(normalizeDateInput(undefined)).toBeNull()
  })
})

describe('formatDateTime', () => {
  it('returns fallback when no valid date is provided', () => {
    expect(formatDateTime(undefined, undefined, 'N/A')).toBe('N/A')
    expect(formatDateTime('not-a-date')).toBe('Unknown')
  })

  it('formats using provided locale and options', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('formatted')

    const result = formatDateTime('2024-01-15T12:30:00Z', { timeZone: 'UTC' }, 'Unknown', 'en-US')

    expect(result).toBe('formatted')
    expect(spy).toHaveBeenCalledWith('en-US', { timeZone: 'UTC' })

    spy.mockRestore()
  })

  it('formats using default locale when none is supplied', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('formatted-default')

    const result = formatDateTime(1_700_000_000)

    expect(result).toBe('formatted-default')
    expect(spy).toHaveBeenCalledWith(undefined)

    spy.mockRestore()
  })
})
