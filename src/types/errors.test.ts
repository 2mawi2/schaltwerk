import { describe, it, expect } from 'vitest'
import {
  getErrorMessage,
  isSchaltError,
  isSessionMissingError,
  type SchaltError
} from './errors'

describe('SchaltError helpers', () => {
  it('identifies structured SchaltError objects', () => {
    const error: SchaltError = {
      type: 'SessionNotFound',
      data: { session_id: 'demo' }
    }
    expect(isSchaltError(error)).toBe(true)
    expect(isSessionMissingError(error)).toBe(true)
  })

  it('falls back when payload is not structured', () => {
    expect(isSchaltError('boom')).toBe(false)
    expect(isSessionMissingError('boom')).toBe(false)
  })

  it('generates useful messages for structured errors', () => {
    const error: SchaltError = {
      type: 'GitOperationFailed',
      data: { operation: 'diff', message: 'fatal: repo missing' }
    }
    expect(getErrorMessage(error)).toContain('Git operation')
  })

  it('returns stringified message for unknown errors', () => {
    const err = new Error('custom failure')
    expect(getErrorMessage(err)).toBe('custom failure')
    expect(getErrorMessage('plain error')).toBe('plain error')
  })
})
