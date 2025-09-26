import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EnrichedSession } from '../types/session'

const useSessionsMock = vi.fn()

vi.mock('../contexts/SessionsContext', () => ({
  useSessions: () => useSessionsMock(),
}))

import { useSpecContent } from './useSpecContent'

function createSession(id: string, content: string, displayName?: string): EnrichedSession {
  return {
    info: {
      session_id: id,
      display_name: displayName,
      spec_content: content,
      branch: `${id}-branch`,
      worktree_path: `/tmp/${id}`,
      base_branch: 'main',
      status: 'spec',
      session_state: 'spec',
      created_at: new Date().toISOString(),
      last_modified: new Date().toISOString(),
      has_uncommitted_changes: false,
      is_current: false,
      session_type: 'worktree',
      container_status: undefined,
      original_agent_type: undefined,
      current_task: '',
      diff_stats: undefined,
      ready_to_merge: false,
      version_group_id: undefined,
      version_number: undefined,
    },
    status: undefined,
    terminals: [],
  }
}

describe('useSpecContent', () => {
  it('returns cached content for a spec session immediately', () => {
    const session = createSession('spec-a', 'Cached spec content', 'Spec A')
    useSessionsMock.mockReturnValueOnce({ allSessions: [session] })

    const { result } = renderHook(() => useSpecContent('spec-a'))

    expect(result.current.hasData).toBe(true)
    expect(result.current.content).toBe('Cached spec content')
    expect(result.current.displayName).toBe('Spec A')
  })

  it('reacts to session content updates', () => {
    const initial = createSession('spec-b', 'Initial content')
    const updated = createSession('spec-b', 'Updated content')

    useSessionsMock.mockReturnValueOnce({ allSessions: [initial] })

    const { result, rerender } = renderHook((sessionId: string) => useSpecContent(sessionId), {
      initialProps: 'spec-b',
    })

    expect(result.current.content).toBe('Initial content')

    useSessionsMock.mockReturnValueOnce({ allSessions: [updated] })
    rerender('spec-b')

    expect(result.current.content).toBe('Updated content')
  })
})
