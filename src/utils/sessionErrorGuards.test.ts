import { describe, it, expect } from 'vitest'
import { isSessionMissingError } from './sessionErrorGuards'

describe('sessionErrorGuards', () => {
  it('detects session missing errors on plain objects with a message field', () => {
    const errorLikeObject = {
      message: "Failed to get session 'demo': Query returned no rows",
      code: 'QueryError',
    }

    expect(isSessionMissingError(errorLikeObject)).toBe(true)
  })

  it('detects session not found errors that include the session name', () => {
    const noisyMessage = "Session 'romantic_tu' not foundsion actually removing anything"
    expect(isSessionMissingError(noisyMessage)).toBe(true)
  })

  it('detects generic session not found phrasing without quotes', () => {
    const message = 'session elastic_euclid not found after project switch'
    expect(isSessionMissingError(message)).toBe(true)
  })
})
