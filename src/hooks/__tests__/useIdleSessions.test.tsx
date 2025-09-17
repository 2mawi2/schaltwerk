import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIdleSessions } from '../useIdleSessions'
import { EnrichedSession, SessionInfo } from '../../types/session'

interface MakeSessionOptions {
  id: string
  lastModifiedOffset?: number
  infoOverrides?: Partial<SessionInfo>
}

const DEFAULT_THRESHOLD = 5 * 60 * 1000
const BASE_TIME = 1_000_000

function makeSession({ id, lastModifiedOffset = 0, infoOverrides = {} }: MakeSessionOptions): EnrichedSession {
  const lastModifiedTs = BASE_TIME - lastModifiedOffset

  const baseInfo: SessionInfo = {
    session_id: id,
    branch: 'main',
    worktree_path: `/tmp/${id}`,
    base_branch: 'main',
    status: 'active',
    is_current: false,
    session_type: 'worktree',
    session_state: 'running',
    ready_to_merge: false,
    last_modified_ts: lastModifiedTs
  }

  return {
    info: { ...baseInfo, ...infoOverrides },
    terminals: []
  }
}

describe('useIdleSessions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('computes idle sessions immediately on mount', () => {
    const idleSession = makeSession({ id: 'idle', lastModifiedOffset: DEFAULT_THRESHOLD + 1 })
    const activeSession = makeSession({ id: 'active', lastModifiedOffset: DEFAULT_THRESHOLD - 1 })

    const { result } = renderHook(() => useIdleSessions({
      sessions: [idleSession, activeSession],
      includeSpecs: false,
      includeReviewed: false,
      idleThresholdMs: DEFAULT_THRESHOLD,
      nowProvider: () => BASE_TIME
    }))

    expect(result.current.idleIds.has('idle')).toBe(true)
    expect(result.current.idleIds.has('active')).toBe(false)
  })

  it('excludes spec and reviewed sessions by default', () => {
    const specSession = makeSession({
      id: 'spec',
      lastModifiedOffset: DEFAULT_THRESHOLD + 10,
      infoOverrides: { session_state: 'spec', status: 'spec' }
    })
    const reviewedSession = makeSession({
      id: 'reviewed',
      lastModifiedOffset: DEFAULT_THRESHOLD + 10,
      infoOverrides: { session_state: 'reviewed', ready_to_merge: true }
    })

    const { result } = renderHook(() => useIdleSessions({
      sessions: [specSession, reviewedSession],
      includeSpecs: false,
      includeReviewed: false,
      idleThresholdMs: DEFAULT_THRESHOLD,
      nowProvider: () => BASE_TIME
    }))

    expect(result.current.idleIds.size).toBe(0)
  })

  it('can include spec and reviewed sessions when requested', () => {
    const specSession = makeSession({
      id: 'spec',
      lastModifiedOffset: DEFAULT_THRESHOLD + 10,
      infoOverrides: { session_state: 'spec', status: 'spec' }
    })
    const reviewedSession = makeSession({
      id: 'reviewed',
      lastModifiedOffset: DEFAULT_THRESHOLD + 10,
      infoOverrides: { session_state: 'reviewed', ready_to_merge: true }
    })

    const { result } = renderHook(() => useIdleSessions({
      sessions: [specSession, reviewedSession],
      includeSpecs: true,
      includeReviewed: true,
      idleThresholdMs: DEFAULT_THRESHOLD,
      nowProvider: () => BASE_TIME
    }))

    expect(result.current.idleIds.has('spec')).toBe(true)
    expect(result.current.idleIds.has('reviewed')).toBe(true)
  })

  it('recomputes on demand using provided nowProvider', () => {
    const session = makeSession({ id: 'aging' })
    let now = BASE_TIME

    const { result } = renderHook(() => useIdleSessions({
      sessions: [session],
      includeSpecs: false,
      includeReviewed: false,
      idleThresholdMs: DEFAULT_THRESHOLD,
      nowProvider: () => now
    }))

    expect(result.current.idleIds.has('aging')).toBe(false)

    now = BASE_TIME + DEFAULT_THRESHOLD + 5

    act(() => {
      result.current.recomputeIdle()
    })

    expect(result.current.idleIds.has('aging')).toBe(true)
  })

  it('automatically recomputes at the interval cadence', () => {
    const session = makeSession({ id: 'interval-test' })
    let now = BASE_TIME

    const { result } = renderHook(() => useIdleSessions({
      sessions: [session],
      includeSpecs: false,
      includeReviewed: false,
      idleThresholdMs: DEFAULT_THRESHOLD,
      nowProvider: () => now
    }))

    expect(result.current.idleIds.has('interval-test')).toBe(false)

    now = BASE_TIME + DEFAULT_THRESHOLD + 5

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(result.current.idleIds.has('interval-test')).toBe(true)
  })

  it('cleans up the interval on unmount', () => {
    const session = makeSession({ id: 'cleanup' })

    const { unmount } = renderHook(() => useIdleSessions({
      sessions: [session],
      includeSpecs: false,
      includeReviewed: false,
      idleThresholdMs: DEFAULT_THRESHOLD,
      nowProvider: () => BASE_TIME
    }))

    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
