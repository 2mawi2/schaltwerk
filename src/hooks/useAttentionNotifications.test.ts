import { describe, it, expect } from 'vitest'
import { shouldCountSessionForAttention } from './useAttentionNotifications'
import type { EnrichedSession } from '../types/session'

const createSession = (
  overrides: Partial<EnrichedSession['info']> = {}
): EnrichedSession => ({
  info: {
    session_id: overrides.session_id ?? 'session-id',
    branch: overrides.branch ?? 'feature',
    worktree_path: overrides.worktree_path ?? '/tmp/session-id',
    base_branch: overrides.base_branch ?? 'main',
    status: overrides.status ?? 'active',
    is_current: overrides.is_current ?? false,
    session_type: overrides.session_type ?? 'worktree',
    session_state: overrides.session_state ?? 'running',
    ready_to_merge: overrides.ready_to_merge ?? false,
    attention_required: overrides.attention_required ?? false,
  },
  status: undefined,
  terminals: [],
})

describe('shouldCountSessionForAttention', () => {
  it('excludes reviewed sessions even when they require attention', () => {
    const session = createSession({
      attention_required: true,
      ready_to_merge: true,
    })

    expect(shouldCountSessionForAttention(session)).toBe(false)
  })

  it('includes running sessions that require attention', () => {
    const session = createSession({
      attention_required: true,
      ready_to_merge: false,
    })

    expect(shouldCountSessionForAttention(session)).toBe(true)
  })

  it('ignores sessions without attention requirements', () => {
    const session = createSession({
      attention_required: false,
      ready_to_merge: false,
    })

    expect(shouldCountSessionForAttention(session)).toBe(false)
  })
})
