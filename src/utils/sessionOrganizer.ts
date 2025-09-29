import type { SessionInfo as CoreSessionInfo } from '../types/session'
import { SessionState } from '../types/session'
import { mapSessionUiState } from './sessionState'

export type SessionInfo = Pick<CoreSessionInfo, 'session_id' | 'session_state' | 'ready_to_merge' | 'status'>

export interface Session {
    info: SessionInfo
}

export type SessionColumns<T extends Session = Session> = [T[], T[], T[]]

/**
 * Organizes sessions into three columns based on their state
 * Column 0: Spec sessions
 * Column 1: Running sessions (not ready to merge)
 * Column 2: Reviewed sessions (ready to merge)
 */
export function organizeSessionsByColumn<T extends Session>(sessions: T[]): SessionColumns<T> {
    const columns: SessionColumns<T> = [[], [], []]
    
    if (!sessions) {
        return columns
    }
    
    sessions.forEach(session => {
        const state = mapSessionUiState(session.info)

        if (state === SessionState.Spec) {
            columns[0].push(session)
            return
        }

        if (state === SessionState.Reviewed) {
            columns[2].push(session)
            return
        }

        columns[1].push(session)
    })
    
    return columns
}

/**
 * Determines which column a session belongs to
 */
export function getSessionColumn(session: Session): 0 | 1 | 2 {
    const state = mapSessionUiState(session.info)

    if (state === SessionState.Spec) {
        return 0
    }

    if (state === SessionState.Reviewed) {
        return 2
    }

    return 1
}

/**
 * Finds the position of a session within the organized columns
 */
export function findSessionPosition<T extends Session>(
    sessionId: string, 
    columns: SessionColumns<T>
): { column: number; row: number } | null {
    for (let col = 0; col < columns.length; col++) {
        const row = columns[col].findIndex(s => s.info.session_id === sessionId)
        if (row !== -1) {
            return { column: col, row }
        }
    }
    return null
}