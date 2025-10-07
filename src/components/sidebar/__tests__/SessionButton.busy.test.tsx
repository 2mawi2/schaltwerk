import { render } from '@testing-library/react'
import { SessionButton } from '../SessionButton'
import type { ComponentProps } from 'react'
import { GithubIntegrationProvider } from '../../../contexts/GithubIntegrationContext'
import { ToastProvider } from '../../../common/toast/ToastProvider'

type SessionButtonProps = ComponentProps<typeof SessionButton>

const baseSession: SessionButtonProps['session'] = {
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

function renderButton(overrides: Partial<SessionButtonProps> = {}) {
  const props: SessionButtonProps = {
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
        <SessionButton {...props} />
      </ToastProvider>
    </GithubIntegrationProvider>
  )
}

describe('SessionButton busy state', () => {
  it('renders busy overlay and disables interactions when isBusy is true', () => {
    const { container } = renderButton({ isBusy: true })

    const root = container.querySelector('[data-session-id="session-123"]')
    expect(root).toHaveAttribute('aria-busy', 'true')

    const overlay = container.querySelector('[data-testid="session-busy-indicator"]')
    expect(overlay).toBeInTheDocument()
  })
})
