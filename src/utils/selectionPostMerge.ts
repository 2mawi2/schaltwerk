import type { EnrichedSession } from '../types/session'

export interface SelectionCandidateInput {
    currentSelectionId: string | null
    visibleSessions: EnrichedSession[]
    previousSessions: EnrichedSession[]
    rememberedId: string | null
    removalCandidate: string | null
    mergedCandidate: string | null
    shouldAdvanceFromMerged: boolean
    shouldPreserveForReviewedRemoval: boolean
    allSessions: EnrichedSession[]
}

function getSessionIds(sessions: EnrichedSession[]): string[] {
    return sessions.map(session => session.info.session_id)
}

function pickNextReviewedAfterMerge(
    mergedCandidate: string,
    previousSessions: EnrichedSession[],
    allSessions: EnrichedSession[]
): string | null {
    const previousReviewed = previousSessions.filter(s => s.info.ready_to_merge)
    const reviewedIds = previousReviewed.map(s => s.info.session_id)

    const mergedIndex = reviewedIds.indexOf(mergedCandidate)
    if (mergedIndex !== -1) {
        const nextId = reviewedIds[mergedIndex + 1]
        if (nextId) {
            return nextId
        }
    }

    const currentReviewedIds = allSessions
        .filter(s => s.info.ready_to_merge && s.info.session_id !== mergedCandidate)
        .map(s => s.info.session_id)
        .sort((a, b) => a.localeCompare(b))

    return currentReviewedIds[0] ?? null
}

export function computeSelectionCandidate(input: SelectionCandidateInput): string | null {
    const {
        currentSelectionId,
        visibleSessions,
        previousSessions,
        rememberedId,
        removalCandidate,
        mergedCandidate,
        shouldAdvanceFromMerged,
        shouldPreserveForReviewedRemoval,
        allSessions,
    } = input

    if (shouldAdvanceFromMerged && mergedCandidate) {
        const nextReviewed = pickNextReviewedAfterMerge(mergedCandidate, previousSessions, allSessions)
        if (nextReviewed) {
            return nextReviewed
        }
    }

    if (shouldPreserveForReviewedRemoval) {
        if (currentSelectionId && visibleSessions.find(s => s.info.session_id === currentSelectionId)) {
            return currentSelectionId
        }
        return null
    }

    const baselineId = currentSelectionId ?? rememberedId ?? removalCandidate ?? mergedCandidate ?? null

    const visibleIds = new Set(getSessionIds(visibleSessions))

    if (rememberedId && rememberedId !== mergedCandidate && visibleIds.has(rememberedId)) {
        return rememberedId
    }

    if (baselineId && previousSessions.length > 0) {
        const previousIndex = previousSessions.findIndex(s => s.info.session_id === baselineId)
        if (previousIndex !== -1) {
            const ordered = getSessionIds(visibleSessions).filter(id => id !== mergedCandidate)
            if (ordered.length > 0) {
                const boundedIndex = Math.min(previousIndex, ordered.length - 1)
                if (boundedIndex >= 0) {
                    return ordered[boundedIndex] ?? null
                }
            }
        }

        const nextFromPrevious = previousSessions
            .map(s => s.info.session_id)
            .find(id => id !== mergedCandidate && visibleIds.has(id))
        if (nextFromPrevious) {
            return nextFromPrevious
        }
    }

    const firstAvailable = visibleSessions.find(s => s.info.session_id !== mergedCandidate)
    return firstAvailable?.info.session_id ?? null
}
