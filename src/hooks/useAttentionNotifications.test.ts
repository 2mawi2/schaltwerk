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
const mockShowSystemNotification = vi.fn().mockResolvedValue(true)
const mockGetCurrentWindowLabel = vi.fn().mockResolvedValue('main')
const mockInvoke = vi.fn().mockResolvedValue({
  attention_notification_mode: 'dock',
  remember_idle_baseline: false,
})

vi.mock('../utils/attentionBridge', () => ({
  reportAttentionSnapshot: (...args: unknown[]) => mockReportAttentionSnapshot(...args),
  requestDockBounce: (...args: unknown[]) => mockRequestDockBounce(...args),
  showSystemNotification: (...args: unknown[]) => mockShowSystemNotification(...args),
  getCurrentWindowLabel: (...args: unknown[]) => mockGetCurrentWindowLabel(...args),
  ensureNotificationPermission: vi.fn().mockResolvedValue('granted'),
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
    mockShowSystemNotification.mockClear()
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
        projectDisplayName: 'project',
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

  it('sends dock bounce and system notification when mode is both', async () => {
    mockInvoke.mockResolvedValue({
      attention_notification_mode: 'both',
      remember_idle_baseline: false,
    })

    const { rerender } = renderHook(({ sessions }) =>
      useAttentionNotifications({
        sessions,
        projectPath: '/Users/test/project',
        projectDisplayName: 'project',
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
    expect(mockShowSystemNotification).toHaveBeenCalled()
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
        projectDisplayName: 'project',
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
})
