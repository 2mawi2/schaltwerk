import { describe, it, expect } from 'vitest'
import { shouldHandleFileChange } from './UnifiedDiffView'
import { ORCHESTRATOR_SESSION_NAME } from '../../constants/sessions'

describe('shouldHandleFileChange', () => {
  it('matches current session when not commander', () => {
    expect(shouldHandleFileChange('s1', false, 's1')).toBe(true)
    expect(shouldHandleFileChange('s2', false, 's1')).toBe(false)
  })

  it('ignores when session name missing', () => {
    expect(shouldHandleFileChange('s1', false, null)).toBe(false)
    expect(shouldHandleFileChange('s1', true, null)).toBe(false)
  })

  it('uses orchestrator session when commander view', () => {
    expect(shouldHandleFileChange(ORCHESTRATOR_SESSION_NAME, true, 'ignored')).toBe(true)
    expect(shouldHandleFileChange('other', true, 'ignored')).toBe(false)
  })
})

