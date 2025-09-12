export interface SessionInfo {
    session_id: string
    session_state: 'spec' | 'running' | 'reviewed'
    ready_to_merge?: boolean
}

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
        if (session.info.session_state === 'spec') {
            columns[0].push(session)
        } else if (session.info.session_state === 'running' && !session.info.ready_to_merge) {
            columns[1].push(session)
        } else if (session.info.ready_to_merge) {
            columns[2].push(session)
        }
    })
    
    return columns
}

/**
 * Determines which column a session belongs to
 */
export function getSessionColumn(session: Session): 0 | 1 | 2 {
    if (session.info.session_state === 'spec') {
        return 0
    } else if (session.info.session_state === 'running' && !session.info.ready_to_merge) {
        return 1
    } else if (session.info.ready_to_merge) {
        return 2
    }
    // Default to running column for any edge cases
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