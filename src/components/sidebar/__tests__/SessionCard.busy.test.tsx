import { render, waitFor } from '@testing-library/react'
import { SessionCard } from '../SessionCard'
import type { ComponentProps } from 'react'
import { GithubIntegrationProvider } from '../../../contexts/GithubIntegrationContext'
import { ToastProvider } from '../../../common/toast/ToastProvider'

type SessionCardProps = ComponentProps<typeof SessionCard>

const baseSession: SessionCardProps['session'] = {
  info: {
    session_id: 'session-123',
    session_state: 'running',
    display_name: 'session-123',
    ready_to_merge: false,
    branch: 'feature/example',
    worktree_path: '/tmp/worktree',
    base_branch: 'main',
    status: 'active',
    is_current: false,
    session_type: 'worktree',
    last_modified: new Date().toISOString(),
    last_modified_ts: Date.now(),
    todo_percentage: 0,
    is_blocked: false,
    has_uncommitted_changes: false,
    original_agent_type: 'claude',
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

function renderButton(overrides: Partial<SessionCardProps> = {}) {
  const props: SessionCardProps = {
    session: baseSession,
    index: 0,
    isSelected: false,
    hasFollowUpMessage: false,
    onSelect: () => {},
    onMarkReady: () => {},
    onUnmarkReady: () => {},
    onCancel: () => {},
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
  it('renders busy overlay and disables interactions when isBusy is true', async () => {
    const { container } = renderButton({ isBusy: true })

    await waitFor(() => {
      const root = container.querySelector(`[data-session-id="${baseSession.info.session_id}"]`)
      expect(root).toHaveAttribute('aria-busy', 'true')
    })

    const overlay = container.querySelector('[data-testid="session-busy-indicator"]')
    expect(overlay).toBeInTheDocument()
  }, 10000) // Set timeout for the test
})
