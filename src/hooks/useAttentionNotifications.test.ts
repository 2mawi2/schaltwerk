import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAttentionNotifications } from './useAttentionNotifications'
import type { EnrichedSession } from '../types/session'

const mockVisibilityState = {
  isForeground: false,
  isVisible: false,
  lastFocusLostAt: null as number | null,
}

vi.mock('./useWindowVisibility', () => ({
  useWindowVisibility: () => mockVisibilityState,
}))

const mockReportAttentionSnapshot = vi.fn().mockResolvedValue({ totalCount: 0, badgeLabel: null })
const mockRequestDockBounce = vi.fn()
const mockGetCurrentWindowLabel = vi.fn().mockResolvedValue('main')
const mockInvoke = vi.fn().mockResolvedValue({
  attention_notification_mode: 'dock',
  remember_idle_baseline: false,
})

vi.mock('../utils/attentionBridge', () => ({
  reportAttentionSnapshot: (...args: unknown[]) => mockReportAttentionSnapshot(...args),
  requestDockBounce: (...args: unknown[]) => mockRequestDockBounce(...args),
  getCurrentWindowLabel: (...args: unknown[]) => mockGetCurrentWindowLabel(...args),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

const createSession = (id: string, attention: boolean): EnrichedSession => ({
  info: {
    session_id: id,
    branch: 'feature',
    worktree_path: `/tmp/${id}`,
    base_branch: 'main',
    status: 'active',
    is_current: false,
    session_type: 'worktree',
    session_state: 'running',
    ready_to_merge: false,
    attention_required: attention,
  },
  status: undefined,
  terminals: [],
})

const flushPromises = () => new Promise<void>(resolve => queueMicrotask(() => resolve()))

describe('useAttentionNotifications', () => {
  beforeEach(() => {
    mockVisibilityState.isForeground = false
    mockVisibilityState.isVisible = false
    mockVisibilityState.lastFocusLostAt = null
    mockReportAttentionSnapshot.mockClear()
    mockRequestDockBounce.mockClear()
    mockGetCurrentWindowLabel.mockResolvedValue('main')
    mockInvoke.mockResolvedValue({
      attention_notification_mode: 'dock',
      remember_idle_baseline: false,
    })
  })

  it('reports project attention count when sessions need attention', async () => {
    const onProjectAttentionChange = vi.fn()
    const { rerender } = renderHook(({ sessions }) =>
      useAttentionNotifications({
        sessions,
        projectPath: '/Users/test/project',
        onProjectAttentionChange,
      })
    , {
      initialProps: { sessions: [createSession('s1', false)] },
    })

    await flushPromises()
    mockReportAttentionSnapshot.mockClear()

    await act(async () => {
      rerender({ sessions: [createSession('s1', true)] })
      await flushPromises()
    })

    expect(onProjectAttentionChange).toHaveBeenLastCalledWith(1)
    expect(mockReportAttentionSnapshot).toHaveBeenCalledWith('main', ['/Users/test/project::s1'])
  })

  it('triggers dock bounce when notifications are enabled', async () => {
    mockInvoke.mockResolvedValue({
      attention_notification_mode: 'dock',
      remember_idle_baseline: false,
    })

    const { rerender } = renderHook(({ sessions }) =>
      useAttentionNotifications({
        sessions,
        projectPath: '/Users/test/project',
      })
    , {
      initialProps: { sessions: [createSession('s2', false)] },
    })

    await flushPromises()

    await act(async () => {
      rerender({ sessions: [createSession('s2', true)] })
      await flushPromises()
    })

    expect(mockRequestDockBounce).toHaveBeenCalled()
  })

  it('honours idle baseline when enabled', async () => {
    mockInvoke.mockResolvedValue({
      attention_notification_mode: 'dock',
      remember_idle_baseline: true,
    })

    mockVisibilityState.isForeground = true

    const { rerender } = renderHook(({ sessions }) =>
      useAttentionNotifications({
        sessions,
        projectPath: '/Users/test/project',
      })
    , {
      initialProps: { sessions: [createSession('s3', true)] },
    })

    await flushPromises()

    mockVisibilityState.isForeground = false
    await act(async () => {
      rerender({ sessions: [createSession('s3', true)] })
      await flushPromises()
    })

    mockRequestDockBounce.mockClear()

    await act(async () => {
      rerender({ sessions: [createSession('s3', false)] })
      await flushPromises()
    })

    await act(async () => {
      rerender({ sessions: [createSession('s3', true)] })
      await flushPromises()
    })

    expect(mockRequestDockBounce).toHaveBeenCalledTimes(1)
  })

  it('aggregates attention across projects for snapshot reporting', async () => {
    const onAttentionSummaryChange = vi.fn()
    const { rerender } = renderHook(({ projectPath, sessions, openProjectPaths }) =>
      useAttentionNotifications({
        sessions,
        projectPath,
        onAttentionSummaryChange,
        openProjectPaths,
      })
    , {
      initialProps: {
        projectPath: '/Users/test/project-a',
        sessions: [createSession('a1', true)],
        openProjectPaths: ['/Users/test/project-a'],
      },
    })

    await flushPromises()
    mockReportAttentionSnapshot.mockClear()
    onAttentionSummaryChange.mockClear()

    await act(async () => {
      rerender({
        projectPath: '/Users/test/project-b',
        sessions: [createSession('b1', true)],
        openProjectPaths: ['/Users/test/project-a', '/Users/test/project-b'],
      })
      await flushPromises()
    })

    expect(onAttentionSummaryChange).toHaveBeenLastCalledWith({
      perProjectCounts: {
        '/Users/test/project-a': 1,
        '/Users/test/project-b': 1,
      },
      totalCount: 2,
    })

    const lastCall = mockReportAttentionSnapshot.mock.calls[mockReportAttentionSnapshot.mock.calls.length - 1]
    expect(lastCall).toEqual([
      'main',
      ['/Users/test/project-a::a1', '/Users/test/project-b::b1'],
    ])
  })

  it('drops projects that are no longer open from attention summary', async () => {
    const onAttentionSummaryChange = vi.fn()
    const { rerender } = renderHook(({ projectPath, sessions, openProjectPaths }) =>
      useAttentionNotifications({
        sessions,
        projectPath,
        onAttentionSummaryChange,
        openProjectPaths,
      })
    , {
      initialProps: {
        projectPath: '/Users/test/project-a',
        sessions: [createSession('a1', true)],
        openProjectPaths: ['/Users/test/project-a'],
      },
    })

    await flushPromises()
    mockReportAttentionSnapshot.mockClear()
    onAttentionSummaryChange.mockClear()

    await act(async () => {
      rerender({
        projectPath: '/Users/test/project-b',
        sessions: [createSession('b1', true)],
        openProjectPaths: ['/Users/test/project-b'],
      })
      await flushPromises()
    })

    expect(onAttentionSummaryChange).toHaveBeenLastCalledWith({
      perProjectCounts: {
        '/Users/test/project-b': 1,
      },
      totalCount: 1,
    })

    const lastCall = mockReportAttentionSnapshot.mock.calls[mockReportAttentionSnapshot.mock.calls.length - 1]
    expect(lastCall).toEqual([
      'main',
      ['/Users/test/project-b::b1'],
    ])
  })

  it('keeps idle baseline keyed per project', async () => {
    mockInvoke.mockResolvedValue({
      attention_notification_mode: 'dock',
      remember_idle_baseline: true,
    })

    mockVisibilityState.isForeground = true

    const { rerender } = renderHook(({ projectPath, sessions, openProjectPaths }) =>
      useAttentionNotifications({
        sessions,
        projectPath,
        openProjectPaths,
      })
    , {
      initialProps: {
        projectPath: '/Users/test/project-a',
        sessions: [createSession('shared', true)],
        openProjectPaths: ['/Users/test/project-a'],
      },
    })

    await flushPromises()

    mockVisibilityState.isForeground = false
    await act(async () => {
      rerender({
        projectPath: '/Users/test/project-a',
        sessions: [createSession('shared', true)],
        openProjectPaths: ['/Users/test/project-a'],
      })
      await flushPromises()
    })

    mockRequestDockBounce.mockClear()

    await act(async () => {
      rerender({
        projectPath: '/Users/test/project-b',
        sessions: [createSession('shared', true)],
        openProjectPaths: ['/Users/test/project-a', '/Users/test/project-b'],
      })
      await flushPromises()
    })

    expect(mockRequestDockBounce).toHaveBeenCalledTimes(1)
  })

  it('excludes reviewed sessions from attention count', async () => {
    const onProjectAttentionChange = vi.fn()

    const runningSession = createSession('running', true)
    const reviewedSession: EnrichedSession = {
      ...createSession('reviewed', true),
      info: {
        ...createSession('reviewed', true).info,
        ready_to_merge: true,
      },
    }

    const { result } = renderHook(() =>
      useAttentionNotifications({
        sessions: [runningSession, reviewedSession],
        projectPath: '/Users/test/project',
        onProjectAttentionChange,
      })
    )

    await flushPromises()

    expect(result.current.projectAttentionCount).toBe(1)
    expect(onProjectAttentionChange).toHaveBeenCalledWith(1)
    expect(mockReportAttentionSnapshot).toHaveBeenCalledWith('main', ['/Users/test/project::running'])
  })

  it('includes reviewed session in count when it becomes unreviewed', async () => {
    const onProjectAttentionChange = vi.fn()

    const reviewedSession: EnrichedSession = {
      ...createSession('session', true),
      info: {
        ...createSession('session', true).info,
        ready_to_merge: true,
      },
    }

    const { rerender } = renderHook(({ sessions }) =>
      useAttentionNotifications({
        sessions,
        projectPath: '/Users/test/project',
        onProjectAttentionChange,
      })
    , {
      initialProps: { sessions: [reviewedSession] },
    })

    await flushPromises()
    expect(onProjectAttentionChange).toHaveBeenCalledWith(0)

    mockReportAttentionSnapshot.mockClear()
    onProjectAttentionChange.mockClear()

    const runningSession = createSession('session', true)
    await act(async () => {
      rerender({ sessions: [runningSession] })
      await flushPromises()
    })

    expect(onProjectAttentionChange).toHaveBeenCalledWith(1)
    expect(mockReportAttentionSnapshot).toHaveBeenCalledWith('main', ['/Users/test/project::session'])
  })
})
