import { render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { SessionCard } from '../SessionCard'
import { GithubIntegrationProvider } from '../../../contexts/GithubIntegrationContext'
import { ToastProvider } from '../../../common/toast/ToastProvider'

type SessionCardProps = ComponentProps<typeof SessionCard>

const baseSession: SessionCardProps['session'] = {
  info: {
    session_id: 'spec-123',
    session_state: 'spec',
    display_name: 'spec-123',
    ready_to_merge: false,
    branch: 'feature/spec',
    worktree_path: '/tmp/spec',
    base_branch: 'main',
    status: 'spec',
    is_current: false,
    session_type: 'worktree',
    last_modified: new Date().toISOString(),
    last_modified_ts: Date.now(),
    todo_percentage: 0,
    is_blocked: false,
    has_uncommitted_changes: false,
    original_agent_type: 'codex',
    diff_stats: {
      files_changed: 0,
      additions: 0,
      deletions: 0,
      insertions: 0
    }
  },
  status: undefined,
  terminals: []
}

function renderCard(overrides: Partial<SessionCardProps> = {}) {
  const props: SessionCardProps = {
    session: baseSession,
    ...overrides
  }

  return render(
    <GithubIntegrationProvider>
      <ToastProvider>
        <SessionCard {...props} />
      </ToastProvider>
    </GithubIntegrationProvider>
  )
}

describe('SessionCard busy state', () => {
  it('shows busy overlay when busy', () => {
    const { container } = renderCard({ isBusy: true })
    const root = container.querySelector('[data-session-id="spec-123"]')
    expect(root).toHaveAttribute('aria-busy', 'true')

    const overlay = container.querySelector('[data-testid="session-busy-indicator"]')
    expect(overlay).toBeInTheDocument()
  })
})
