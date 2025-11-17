import { logger } from '../utils/logger'

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
