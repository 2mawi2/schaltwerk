import { logger } from '../utils/logger'

/**
 * Format a timestamp as a friendly relative string (e.g., "today", "yesterday", "3 days ago")
 */
export function formatRelativeDate(timestamp: string | Date): string {
    try {
        const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp
        if (isNaN(date.getTime())) {
            return 'unknown'
        }

        const now = new Date()
        const diffMs = now.getTime() - date.getTime()
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

        if (diffDays === 0) return 'today'
        if (diffDays === 1) return 'yesterday'
        if (diffDays < 7) return `${diffDays} days ago`
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
        return date.toLocaleDateString()
    } catch (e) {
        logger.error('Error formatting relative date:', e)
        return 'unknown'
    }
}

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

/**
 * Format a timestamp using a human-friendly relative string (e.g. "3h ago")
 */
export function formatDurationFromNow(timestamp?: string): string {
    if (!timestamp || !timestamp.trim()) {
        return 'unknown'
    }

    try {
        const parsed = new Date(timestamp)
        if (Number.isNaN(parsed.getTime())) {
            return timestamp
        }

        const now = new Date()
        const diffMs = now.getTime() - parsed.getTime()
        if (diffMs < 0) {
            return 'in the future'
        }

        const seconds = Math.floor(diffMs / 1000)
        if (seconds < 60) {
            return `${seconds}s ago`
        }

        const minutes = Math.floor(seconds / 60)
        if (minutes < 60) {
            return `${minutes}m ago`
        }

        const hours = Math.floor(minutes / 60)
        if (hours < 24) {
            return `${hours}h ago`
        }

        const days = Math.floor(hours / 24)
        if (days < 30) {
            return `${days}d ago`
        }

        const months = Math.floor(days / 30)
        if (months < 12) {
            return `${months}mo ago`
        }

        const years = Math.floor(months / 12)
        return `${years}y ago`
    } catch (error) {
        logger.error('Error formatting duration:', error)
        return timestamp
    }
}
