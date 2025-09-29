import { EnrichedSession } from '../types/session'

export interface SelectionMemoryEntry {
  lastSelection: string | null
  lastSessions: EnrichedSession[]
}

export function captureSelectionSnapshot(entry: SelectionMemoryEntry, visibleSessions: EnrichedSession[]) {
  const previousSessions = entry.lastSessions.slice()
  entry.lastSessions = visibleSessions.slice()
  return { previousSessions }
}
