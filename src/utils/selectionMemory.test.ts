import { describe, expect, it } from 'vitest'
import { captureSelectionSnapshot, SelectionMemoryEntry } from './selectionMemory'
import { mockEnrichedSession } from '../test-utils/sessionMocks'
import { EnrichedSession, SessionState } from '../types/session'

describe('captureSelectionSnapshot', () => {
  it('preserves previous sessions when visible sessions change', () => {
    const previous: EnrichedSession[] = [
      mockEnrichedSession('spec-a', SessionState.Spec, false) as EnrichedSession,
      mockEnrichedSession('spec-b', SessionState.Spec, false) as EnrichedSession
    ]
    const entry: SelectionMemoryEntry = {
      lastSelection: 'spec-b',
      lastSessions: previous,
    }
    const nextVisible: EnrichedSession[] = [
      mockEnrichedSession('spec-a', SessionState.Spec, false) as EnrichedSession,
      mockEnrichedSession('spec-c', SessionState.Spec, false) as EnrichedSession
    ]

    const { previousSessions } = captureSelectionSnapshot(entry, nextVisible)

    nextVisible.push(mockEnrichedSession('spec-d', SessionState.Spec, false) as EnrichedSession)

    expect(entry.lastSessions).not.toBe(nextVisible)
    expect(previousSessions.map(s => s.info.session_id)).toEqual(['spec-a', 'spec-b'])
  })
})
