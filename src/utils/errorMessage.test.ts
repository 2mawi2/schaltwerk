import { describe, it, expect } from 'vitest'
import { extractErrorMessage } from './errorMessage'

describe('extractErrorMessage', () => {
  it('returns message from Error instance', () => {
    const error = new Error('Something went wrong')
    expect(extractErrorMessage(error)).toBe('Something went wrong')
  })

  it('returns string directly when error is a string', () => {
    expect(extractErrorMessage('gh command failed')).toBe('gh command failed')
  })

  it('returns message property from object with message', () => {
    const error = { message: 'Custom error message' }
    expect(extractErrorMessage(error)).toBe('Custom error message')
  })

  it('returns fallback for undefined', () => {
    expect(extractErrorMessage(undefined)).toBe('An unknown error occurred')
  })

  it('returns fallback for null', () => {
    expect(extractErrorMessage(null)).toBe('An unknown error occurred')
  })

  it('returns fallback for empty string', () => {
    expect(extractErrorMessage('')).toBe('An unknown error occurred')
  })

  it('returns fallback for whitespace-only string', () => {
    expect(extractErrorMessage('   ')).toBe('An unknown error occurred')
  })

  it('returns fallback for object without message property', () => {
    const error = { code: 1, stderr: 'error output' }
    expect(extractErrorMessage(error)).toBe('An unknown error occurred')
  })

  it('handles Error with empty message', () => {
    const error = new Error('')
    expect(extractErrorMessage(error)).toBe('An unknown error occurred')
  })

  it('trims whitespace from messages', () => {
    expect(extractErrorMessage('  error message  ')).toBe('error message')
  })

  it('handles number values', () => {
    expect(extractErrorMessage(42)).toBe('An unknown error occurred')
  })

  it('handles boolean values', () => {
    expect(extractErrorMessage(true)).toBe('An unknown error occurred')
    expect(extractErrorMessage(false)).toBe('An unknown error occurred')
  })

  it('supports custom fallback message', () => {
    expect(extractErrorMessage(undefined, 'Custom fallback')).toBe('Custom fallback')
    expect(extractErrorMessage(null, 'Custom fallback')).toBe('Custom fallback')
    expect(extractErrorMessage('', 'Custom fallback')).toBe('Custom fallback')
  })

  it('returns error property if message is not present but error is', () => {
    const error = { error: 'Error from API' }
    expect(extractErrorMessage(error)).toBe('Error from API')
  })

  it('prefers message over error property', () => {
    const error = { message: 'Message', error: 'Error' }
    expect(extractErrorMessage(error)).toBe('Message')
  })
})
