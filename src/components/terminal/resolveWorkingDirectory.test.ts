import { describe, it, expect } from 'vitest'
import { resolveWorkingDirectory } from './resolveWorkingDirectory'
import type { Selection } from '../../hooks/useSelection'
import type { EnrichedSession, SessionInfo } from '../../types/session'

function buildSessionInfo(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    session_id: 'test-session',
    branch: 'main',
    worktree_path: '/worktrees/test-session',
    base_branch: 'main',
    status: 'active',
    is_current: true,
    session_type: 'worktree',
    session_state: 'running',
    ...overrides,
  }
}

function buildSession(overrides: Partial<SessionInfo>): EnrichedSession {
  return {
    info: buildSessionInfo(overrides),
    status: undefined,
    terminals: [],
  }
}

describe('resolveWorkingDirectory', () => {
  it('returns the selection worktree when available', () => {
    const selection: Selection = {
      kind: 'session',
      payload: 'alpha',
      worktreePath: '/sessions/alpha',
      sessionState: 'running',
    }

    const result = resolveWorkingDirectory(selection, '/project/root', [])
    expect(result).toBe('/sessions/alpha')
  })

  it('falls back to the matching session entry when selection lacks worktreePath', () => {
    const selection: Selection = {
      kind: 'session',
      payload: 'alpha',
      sessionState: 'running',
    }
    const sessions: EnrichedSession[] = [
      buildSession({ session_id: 'alpha', worktree_path: '/worktrees/alpha' }),
    ]

    const result = resolveWorkingDirectory(selection, '/project/root', sessions)
    expect(result).toBe('/worktrees/alpha')
  })

  it('falls back to terminals working directory when nothing else is available', () => {
    const selection: Selection = {
      kind: 'session',
      payload: 'alpha',
      sessionState: 'running',
    }

    const result = resolveWorkingDirectory(selection, '/fallback/root', [])
    expect(result).toBe('/fallback/root')
  })

  it('returns the provided directory for orchestrator selections', () => {
    const selection: Selection = {
      kind: 'orchestrator',
      projectPath: '/project/root',
    }

    const result = resolveWorkingDirectory(selection, '/project/root', [])
    expect(result).toBe('/project/root')
  })
})
