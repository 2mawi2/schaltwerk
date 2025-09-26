import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionButton } from './SessionButton'
import type { EnrichedSession, SessionInfo } from '../../types/session'

const baseInfo: SessionInfo = {
  session_id: 's1',
  display_name: 's1',
  branch: 'schaltwerk/s1',
  worktree_path: '/tmp/wt',
  base_branch: 'main',
  status: 'active',
  last_modified: new Date().toISOString(),
  has_uncommitted_changes: false,
  is_current: false,
  session_type: 'worktree',
  container_status: undefined,
  session_state: 'running',
  current_task: undefined,
  todo_percentage: undefined,
  is_blocked: false,
  diff_stats: { files_changed: 1, additions: 2, deletions: 3, insertions: 2 },
  ready_to_merge: false,
  original_agent_type: 'claude',
}

const baseSession: EnrichedSession = {
  info: baseInfo,
  status: undefined,
  terminals: [] as string[],
}

describe('SessionButton dirty indicator', () => {
  it('shows dirty indicator for reviewed sessions with uncommitted changes', () => {
    const session: EnrichedSession = { 
      ...baseSession, 
      info: { 
        ...baseSession.info, 
        has_uncommitted_changes: true,
        ready_to_merge: true,
        status: 'dirty',
        top_uncommitted_paths: ['src/main.rs', 'README.md']
      } 
    }
    render(
      <SessionButton
        session={session}
        index={0}
        isSelected={false}

        hasFollowUpMessage={false}
        onSelect={() => {}}
        onMarkReady={() => {}}
        onUnmarkReady={() => {}}
        onCancel={() => {}}
        isRunning={false}
      />
    )

    const indicator = screen.getByRole('button', { name: /has uncommitted changes/i })
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveAttribute('title')
  })

  it('does not show dirty indicator for running sessions even when dirty', () => {
    const session: EnrichedSession = {
      ...baseSession,
      info: {
        ...baseSession.info,
        has_uncommitted_changes: true,
        ready_to_merge: false,
        status: 'dirty',
      },
    }

    render(
      <SessionButton
        session={session}
        index={0}
        isSelected={false}

        hasFollowUpMessage={false}
        onSelect={() => {}}
        onMarkReady={() => {}}
        onUnmarkReady={() => {}}
        onCancel={() => {}}
        isRunning={false}
      />
    )

    expect(screen.queryByRole('button', { name: /has uncommitted changes/i })).toBeNull()
  })

  it('does not show dirty indicator when has_uncommitted_changes is false for reviewed session', () => {
    render(
      <SessionButton
        session={{
          ...baseSession,
          info: {
            ...baseSession.info,
            ready_to_merge: true,
            status: 'active',
          },
        }}
        index={0}
        isSelected={false}

        hasFollowUpMessage={false}
        onSelect={() => {}}
        onMarkReady={() => {}}
        onUnmarkReady={() => {}}
        onCancel={() => {}}
        isRunning={false}
      />
    )

    expect(screen.queryByRole('button', { name: /has uncommitted changes/i })).toBeNull()
  })
})

describe('SessionButton running tag', () => {
  it('shows running tag when session is reviewed but still running', () => {
    const session: EnrichedSession = {
      ...baseSession,
      info: {
        ...baseSession.info,
        ready_to_merge: true,
        session_state: 'running',
      },
    }

    render(
      <SessionButton
        session={session}
        index={0}
        isSelected={false}

        hasFollowUpMessage={false}
        onSelect={() => {}}
        onMarkReady={() => {}}
        onUnmarkReady={() => {}}
        onCancel={() => {}}
        isRunning
      />
    )

    expect(screen.getByText('Running')).toBeInTheDocument()
  })
})

describe('SessionButton review cooldown', () => {
  it('disables the mark reviewed action when mark ready is temporarily blocked', () => {
    render(
      <SessionButton
        session={baseSession}
        index={0}
        isSelected={false}

        hasFollowUpMessage={false}
        onSelect={() => {}}
        onMarkReady={() => {}}
        onUnmarkReady={() => {}}
        onCancel={() => {}}
        isRunning
        isMarkReadyDisabled
      />
    )

    const markReviewedButton = screen.getByRole('button', { name: 'Mark as reviewed' })
    expect(markReviewedButton).toBeDisabled()
  })
})
