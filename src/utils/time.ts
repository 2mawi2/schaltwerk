import { logger } from '../utils/logger'

/**
 * Format a timestamp as a relative time string (e.g., "2m", "3h", "5d")
 * Handles UTC timestamps correctly by ensuring both dates are in UTC
 */
export function formatLastActivity(lastModified?: string): string {
    if (!lastModified || lastModified === '') {
        return 'unknown'
    }
    
    try {
        const date = new Date(lastModified)
        
        // Check if the date is valid
        if (isNaN(date.getTime())) {
            return 'unknown'
        }
        
        // Get current time in UTC
        const now = new Date()
        
        // Calculate difference in milliseconds
        // Both dates are already in UTC (JavaScript Date handles ISO 8601 UTC strings correctly)
        const diffMs = now.getTime() - date.getTime()
        
        // Convert to minutes
        const diffMins = Math.floor(diffMs / 60000)
        
        if (diffMins < 1) return 'now'
        if (diffMins < 60) return `${diffMins}m`
        
        // Convert to hours
        const diffHours = Math.floor(diffMins / 60)
        if (diffHours < 24) return `${diffHours}h`
        
        // Convert to days
        const diffDays = Math.floor(diffHours / 24)
        return `${diffDays}d`
    } catch (e) {
        logger.error('Error parsing date:', e)
        return 'unknown'
    }
}