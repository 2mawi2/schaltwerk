import { EnrichedSession, SessionInfo } from '../types/session'

// These types are now imported from the centralized types/session.ts file

// Normalize backend states to UI categories
export function mapSessionUiState(info: SessionInfo): 'spec' | 'running' | 'reviewed' {
    if (info.session_state === 'spec' || info.status === 'spec') return 'spec'
    if (info.ready_to_merge) return 'reviewed'
    return 'running'
}

export function isSpec(info: SessionInfo): boolean { 
    return mapSessionUiState(info) === 'spec' 
}

export function isReviewed(info: SessionInfo): boolean { 
    return mapSessionUiState(info) === 'reviewed' 
}

export function isRunning(info: SessionInfo): boolean {
    return !isReviewed(info) && !isSpec(info)
}

/**
 * Calculate filter counts for sessions
 */
export function calculateFilterCounts(sessions: EnrichedSession[]) {
    const allCount = sessions.length
    const specsCount = sessions.filter(s => isSpec(s.info)).length
    const runningCount = sessions.filter(s => isRunning(s.info)).length
    const reviewedCount = sessions.filter(s => isReviewed(s.info)).length
    
    return { allCount, specsCount, runningCount, reviewedCount }
}

/**
 * Search sessions by session ID, display name, and spec content
 */
export function searchSessions(sessions: EnrichedSession[], searchQuery: string): EnrichedSession[] {
    if (!searchQuery.trim()) return sessions
    
    const query = searchQuery.toLowerCase().trim()
    return sessions.filter(session => {
        const sessionId = session.info.session_id.toLowerCase()
        const displayName = (session.info.display_name || '').toLowerCase()
        const specContent = (session.info.spec_content || '').toLowerCase()
        
        // Search in combined content
        const allContent = `${sessionId} ${displayName} ${specContent}`.toLowerCase()
        
        return allContent.includes(query)
    })
}