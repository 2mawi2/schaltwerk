import { render, fireEvent, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionVersionGroup } from './SessionVersionGroup'
import type { SessionVersionGroup as SessionVersionGroupType } from '../../utils/sessionVersions'
import type { EnrichedSession } from '../../types/session'

vi.mock('./SessionCard', () => ({
  SessionCard: ({ session }: { session: EnrichedSession }) => (
    <div data-testid="session-card">{session.info.session_id}</div>
  )
}))

function createVersion({
  id,
  attentionRequired = false,
}: {
  id: string
  attentionRequired?: boolean
}): SessionVersionGroupType['versions'][number] {
  const info: EnrichedSession['info'] = {
    session_id: id,
    display_name: id,
    version_number: 1,
    branch: `${id}-branch`,
    worktree_path: `/tmp/${id}`,
    base_branch: 'main',
    status: 'active',
    session_state: 'running',
    is_current: false,
    session_type: 'worktree',
    ready_to_merge: false,
    attention_required: attentionRequired,
    original_agent_type: 'claude'
  }

  return {
    versionNumber: 1,
    session: {
      info,
      status: undefined,
      terminals: []
    }
  }
}

const baseGroup: SessionVersionGroupType = {
  baseName: 'feature-A',
  isVersionGroup: true,
  versions: [
    createVersion({ id: 'feature-A_v1', attentionRequired: false }),
    createVersion({ id: 'feature-A_v2', attentionRequired: true })
  ]
}

const requiredCallbacks = {
  hasFollowUpMessage: () => false,
  onSelect: vi.fn(),
  onMarkReady: vi.fn(),
  onUnmarkReady: vi.fn(),
  onCancel: vi.fn()
}

describe('SessionVersionGroup status summary', () => {
  it('surfaces active and idle counts on the group header and keeps them visible when collapsed', () => {
    const { getByLabelText, getByRole, getByTestId } = render(
      <SessionVersionGroup
        group={baseGroup}
        selection={{ kind: 'session', payload: 'unrelated' }}
        startIndex={0}
        {...requiredCallbacks}
      />
    )

    expect(getByLabelText('1 Active session')).toBeInTheDocument()
    expect(getByLabelText('1 Idle session')).toBeInTheDocument()

    const statusRow = getByTestId('version-group-status')
    expect(statusRow.className).not.toContain('flex-wrap')
    const scoped = within(statusRow)
    expect(scoped.getByLabelText('1 Active session')).toBeInTheDocument()
    expect(scoped.getByLabelText('1 Idle session')).toBeInTheDocument()

    const toggle = getByRole('button', { name: /feature-A/i })
    fireEvent.click(toggle)

    expect(getByLabelText('1 Active session')).toBeVisible()
    expect(getByLabelText('1 Idle session')).toBeVisible()
  })
})
