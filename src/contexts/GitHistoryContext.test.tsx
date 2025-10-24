import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, useEffect } from 'react'
import { GitHistoryProvider, useGitHistory } from './GitHistoryContext'
import { TauriCommands } from '../common/tauriCommands'

const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

function HistoryHarness({ repoPath, onReady }: { repoPath: string; onReady: (api: ReturnType<typeof useGitHistory>) => void }) {
  const api = useGitHistory(repoPath)
  useEffect(() => {
    onReady(api)
  }, [api, onReady])
  return null
}

describe('GitHistoryContext', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('deduplicates ensureLoaded calls for the same repo', async () => {
    mockInvoke.mockResolvedValue({
      items: [
        {
          id: 'abc1234',
          parentIds: [],
          subject: 'Initial commit',
          author: 'Alice',
          timestamp: 1720000000000,
          references: [],
          fullHash: 'abc1234fffffffabc1234fffffffabc1234fffffff',
        },
      ],
      hasMore: false,
      nextCursor: undefined,
      headCommit: 'abc1234fffffffabc1234fffffffabc1234fffffff',
    })

    let api: ReturnType<typeof useGitHistory> | null = null

    render(
      <GitHistoryProvider>
        <HistoryHarness repoPath="/repo/project" onReady={value => { api = value }} />
      </GitHistoryProvider>
    )

    await waitFor(() => {
      expect(api).not.toBeNull()
    })

    await act(async () => {
      await api!.ensureLoaded()
    })

    expect(mockInvoke).toHaveBeenCalledTimes(1)

    await act(async () => {
      await api!.ensureLoaded()
    })

    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('passes the previous head when refreshing history', async () => {
    const head = 'abc1234fffffffabc1234fffffffabc1234fffffff'

    mockInvoke
      .mockResolvedValueOnce({
        items: [
          {
            id: 'abc1234',
            parentIds: [],
            subject: 'Initial commit',
            author: 'Alice',
            timestamp: 1720000000000,
            references: [],
            fullHash: head,
          },
        ],
        hasMore: false,
        nextCursor: undefined,
        headCommit: head,
      })
      .mockResolvedValueOnce({
        items: [],
        hasMore: false,
        nextCursor: undefined,
        headCommit: head,
        unchanged: true,
      })

    let api: ReturnType<typeof useGitHistory> | null = null

    render(
      <GitHistoryProvider>
        <HistoryHarness repoPath="/repo/project" onReady={value => { api = value }} />
      </GitHistoryProvider>
    )

    await waitFor(() => {
      expect(api).not.toBeNull()
    })

    await act(async () => {
      await api!.ensureLoaded()
    })

    await act(async () => {
      await api!.refresh()
    })

    expect(mockInvoke).toHaveBeenNthCalledWith(
      2,
      TauriCommands.GetGitGraphHistory,
      expect.objectContaining({
        repoPath: '/repo/project',
        sinceHead: head,
        limit: 100,
      })
    )
  })
})
