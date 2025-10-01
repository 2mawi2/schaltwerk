import { describe, it, expect } from 'vitest'
import { computeSelectionCandidate } from './selectionPostMerge'
import type { EnrichedSession } from '../types/session'
import { SessionState } from '../types/session'

function session(id: string, ready = false, state: SessionState = ready ? SessionState.Reviewed : SessionState.Running): EnrichedSession {
    return {
        info: {
            session_id: id,
            branch: `branch/${id}`,
            worktree_path: `/wt/${id}`,
            base_branch: 'main',
            parent_branch: 'main',
            status: state === SessionState.Spec ? 'spec' : 'active',
            session_state: state,
            ready_to_merge: ready,
            is_current: false,
            session_type: 'worktree'
        },
        terminals: []
    }
}

describe('computeSelectionCandidate', () => {
    it('prefers next reviewed session when advancing from merged reviewed', () => {
        const reviewedOne = session('reviewed-one', true, SessionState.Reviewed)
        const reviewedTwo = session('reviewed-two', true, SessionState.Reviewed)
        const running = session('running-session')

        const candidate = computeSelectionCandidate({
            currentSelectionId: 'reviewed-one',
            visibleSessions: [reviewedOne, reviewedTwo, running],
            previousSessions: [reviewedOne, reviewedTwo, running],
            rememberedId: null,
            removalCandidate: null,
            mergedCandidate: 'reviewed-one',
            shouldAdvanceFromMerged: true,
            shouldPreserveForReviewedRemoval: false,
            allSessions: [reviewedOne, reviewedTwo, running]
        })

        expect(candidate).toBe('reviewed-two')
    })

    it('returns null when merged reviewed session has no peers', () => {
        const reviewed = session('solo-reviewed', true, SessionState.Reviewed)

        const candidate = computeSelectionCandidate({
            currentSelectionId: 'solo-reviewed',
            visibleSessions: [reviewed],
            previousSessions: [reviewed],
            rememberedId: null,
            removalCandidate: null,
            mergedCandidate: 'solo-reviewed',
            shouldAdvanceFromMerged: true,
            shouldPreserveForReviewedRemoval: false,
            allSessions: [reviewed]
        })

        expect(candidate).toBeNull()
    })

    it('honours preservation when reviewed removed under other filter', () => {
        const running = session('running-session')
        const reviewed = session('reviewed-session', true, SessionState.Reviewed)

        const candidate = computeSelectionCandidate({
            currentSelectionId: 'running-session',
            visibleSessions: [running],
            previousSessions: [running, reviewed],
            rememberedId: null,
            removalCandidate: 'reviewed-session',
            mergedCandidate: null,
            shouldAdvanceFromMerged: false,
            shouldPreserveForReviewedRemoval: true,
            allSessions: [running, reviewed]
        })

        expect(candidate).toBe('running-session')
    })

    it('falls back to remembered id when still visible', () => {
        const running = session('running-session')
        const other = session('other-session')

        const candidate = computeSelectionCandidate({
            currentSelectionId: null,
            visibleSessions: [running, other],
            previousSessions: [running, other],
            rememberedId: 'other-session',
            removalCandidate: null,
            mergedCandidate: null,
            shouldAdvanceFromMerged: false,
            shouldPreserveForReviewedRemoval: false,
            allSessions: [running, other]
        })

        expect(candidate).toBe('other-session')
    })
})
