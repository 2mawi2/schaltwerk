import { EnrichedSession } from '../types/session'
import { isReviewed, isRunning, isSpec, mapSessionUiState } from './sessionState'

export { mapSessionUiState, isSpec, isReviewed, isRunning }

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