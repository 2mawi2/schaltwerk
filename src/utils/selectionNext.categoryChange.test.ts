import { describe, it, expect } from 'vitest'
import { findPreviousSessionIndex, EnrichedSessionLike } from './selectionNext'

const sessions = (ids: string[]): EnrichedSessionLike[] => ids.map(id => ({ info: { session_id: id } }))

describe('findPreviousSessionIndex', () => {
  it('finds the correct index of a session', () => {
    const sessionList = sessions(['session-a', 'session-b', 'session-c'])
    expect(findPreviousSessionIndex(sessionList, 'session-b')).toBe(1)
    expect(findPreviousSessionIndex(sessionList, 'session-c')).toBe(2)
    expect(findPreviousSessionIndex(sessionList, 'session-a')).toBe(0)
  })

  it('returns -1 when session is not found', () => {
    const sessionList = sessions(['session-a', 'session-b'])
    expect(findPreviousSessionIndex(sessionList, 'session-missing')).toBe(-1)
  })
})

describe('Category Change Focus Behavior', () => {
  it('selects session at same index position when available', () => {
    // Scenario: User has sessions [A, B, C, D] in "Running" filter, B is selected at index 1
    const previousSessions = sessions(['session-a', 'session-b', 'session-c', 'session-d'])
    const selectedSessionId = 'session-b'
    const previousIndex = findPreviousSessionIndex(previousSessions, selectedSessionId)
    
    // User marks B as reviewed, now only [A, C, D] are visible in "Running" filter
    const newSessions = sessions(['session-a', 'session-c', 'session-d'])
    
    // Should select the session now at index 1 (which is C)
    const targetIndex = Math.min(previousIndex, newSessions.length - 1)
    const expectedSelection = newSessions[targetIndex]
    
    expect(previousIndex).toBe(1)
    expect(targetIndex).toBe(1)
    expect(expectedSelection.info.session_id).toBe('session-c')
  })

  it('selects last session when previous index is out of bounds', () => {
    // Scenario: User has sessions [A, B, C] in "Running" filter, C is selected at index 2
    const previousSessions = sessions(['session-a', 'session-b', 'session-c'])
    const selectedSessionId = 'session-c'
    const previousIndex = findPreviousSessionIndex(previousSessions, selectedSessionId)
    
    // User marks C as reviewed, now only [A, B] are visible in "Running" filter
    const newSessions = sessions(['session-a', 'session-b'])
    
    // Should select the session at the new last position (B at index 1)
    const targetIndex = Math.min(previousIndex, newSessions.length - 1)
    const expectedSelection = newSessions[targetIndex]
    
    expect(previousIndex).toBe(2)
    expect(targetIndex).toBe(1)
    expect(expectedSelection.info.session_id).toBe('session-b')
  })

  it('selects first session when previous session not found', () => {
    // Scenario: Session somehow not found in previous list (edge case)
    const previousSessions = sessions(['session-a', 'session-b'])
    const selectedSessionId = 'session-missing'
    const previousIndex = findPreviousSessionIndex(previousSessions, selectedSessionId)
    
    const newSessions = sessions(['session-x', 'session-y'])
    
    // Should fallback to first session when previous index is -1
    const targetIndex = previousIndex >= 0 ? Math.min(previousIndex, newSessions.length - 1) : 0
    const expectedSelection = newSessions[targetIndex]
    
    expect(previousIndex).toBe(-1)
    expect(targetIndex).toBe(0)
    expect(expectedSelection.info.session_id).toBe('session-x')
  })

  it('maintains position when multiple sessions change category', () => {
    // Scenario: User has sessions [A, B, C, D, E] in "Running" filter, C is selected at index 2
    const previousSessions = sessions(['session-a', 'session-b', 'session-c', 'session-d', 'session-e'])
    const selectedSessionId = 'session-c'
    const previousIndex = findPreviousSessionIndex(previousSessions, selectedSessionId)
    
    // User marks B and C as reviewed, now only [A, D, E] are visible in "Running" filter
    const newSessions = sessions(['session-a', 'session-d', 'session-e'])
    
    // Should select the session now at index 2 (which is E, but clamped to last available)
    const targetIndex = Math.min(previousIndex, newSessions.length - 1)
    const expectedSelection = newSessions[targetIndex]
    
    expect(previousIndex).toBe(2)
    expect(targetIndex).toBe(2)
    expect(expectedSelection.info.session_id).toBe('session-e')
  })
})

describe('Real-world Category Change Scenarios', () => {
  it('handles moving session from Running to Reviewed', () => {
    // Initial state: Running sessions with session-test-auth selected at position 2
    const runningBefore = sessions(['session-main', 'session-feature', 'session-test-auth', 'session-bugfix'])
    const selectedId = 'session-test-auth'
    const prevIndex = findPreviousSessionIndex(runningBefore, selectedId)
    
    // After marking session-test-auth as reviewed, it disappears from Running filter
    const runningAfter = sessions(['session-main', 'session-feature', 'session-bugfix'])
    
    // Should select session-bugfix (the session that took position 2)
    const targetIndex = Math.min(prevIndex, runningAfter.length - 1)
    const newSelection = runningAfter[targetIndex]
    
    expect(prevIndex).toBe(2)
    expect(targetIndex).toBe(2)
    expect(newSelection.info.session_id).toBe('session-bugfix')
  })

  it('handles changing filter from All to Plans', () => {
    // Initial state: All sessions with mixed types, user selects session at index 3
    const allSessions = sessions(['plan-a', 'running-b', 'running-c', 'plan-d', 'running-e'])
    const selectedId = 'plan-d'
    const prevIndex = findPreviousSessionIndex(allSessions, selectedId)
    
    // User switches to Plans filter, only plan sessions visible
    const planSessions = sessions(['plan-a', 'plan-d'])
    
    // Since plan-d is still visible, but we're testing the general logic:
    // If plan-d disappeared, we'd select the session at position 3 or last available
    const targetIndex = Math.min(prevIndex, planSessions.length - 1)
    const newSelection = planSessions[targetIndex]
    
    expect(prevIndex).toBe(3)
    expect(targetIndex).toBe(1) // Clamped to last available
    expect(newSelection.info.session_id).toBe('plan-d')
  })
})