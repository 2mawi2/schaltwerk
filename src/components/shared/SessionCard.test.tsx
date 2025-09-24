import { render, screen } from '@testing-library/react'
import { SessionCard } from './SessionCard'
import { SessionState, SessionInfo } from '../../types/session'

describe('SessionCard', () => {
    const baseSessionInfo: SessionInfo = {
        session_id: 'session-123',
        display_name: 'My Session',
        branch: 'schaltwerk/session-123',
        worktree_path: '/tmp/worktrees/session-123',
        base_branch: 'main',
        status: 'active',
        is_current: false,
        session_type: 'worktree',
        session_state: SessionState.Running,
        ready_to_merge: true
    }

    const buildSession = (overrides: Partial<SessionInfo> = {}) => ({
        info: {
            ...baseSessionInfo,
            ...overrides
        },
        status: undefined,
        terminals: []
    })

    it('shows the running tag for reviewed sessions that are still running', () => {
        const session = buildSession()

        render(
            <SessionCard
                session={session}
                hideActions
                hideKeyboardShortcut
            />
        )

        expect(screen.getByText('✓ Reviewed')).toBeInTheDocument()
        expect(screen.getByText('Running')).toBeInTheDocument()
    })
})
