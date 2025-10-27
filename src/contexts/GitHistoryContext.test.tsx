import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import { GitHistoryProvider, useGitHistory } from './GitHistoryContext'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from '../utils/logger'

const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function HistoryHarness({ repoPath, onReady }: { repoPath: string; onReady: (api: ReturnType<typeof useGitHistory>) => void }) {
  const api = useGitHistory(repoPath)
  onReady(api)
  return null
}

describe('GitHistoryContext', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    ;(logger.debug as unknown as vi.Mock).mockReset()
    ;(logger.info as unknown as vi.Mock).mockReset()
    ;(logger.warn as unknown as vi.Mock).mockReset()
    ;(logger.error as unknown as vi.Mock).mockReset()
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

    let latestApi: ReturnType<typeof useGitHistory> | null = null

    render(
      <GitHistoryProvider>
        <HistoryHarness
          repoPath="/repo/project"
          onReady={value => {
            latestApi = value
          }}
        />
      </GitHistoryProvider>
    )

    await waitFor(() => {
      expect(latestApi).not.toBeNull()
    })

    await act(async () => {
      await latestApi!.ensureLoaded()
    })

    expect(mockInvoke).toHaveBeenCalledTimes(1)

    await act(async () => {
      await latestApi!.ensureLoaded()
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

    let latestApi: ReturnType<typeof useGitHistory> | null = null

    render(
      <GitHistoryProvider>
        <HistoryHarness
          repoPath="/repo/project"
          onReady={value => {
            latestApi = value
          }}
        />
      </GitHistoryProvider>
    )

    await waitFor(() => {
      expect(latestApi).not.toBeNull()
    })

    await act(async () => {
      await latestApi!.ensureLoaded()
    })

    await act(async () => {
      await latestApi!.refresh()
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
  it('preserves appended commits after a refresh and retains the latest cursor', async () => {
    const firstPage = {
      items: [
        {
          id: 'c0',
          parentIds: [],
          subject: 'Initial commit',
          author: 'Alice',
          timestamp: 1720000000000,
          references: [],
          fullHash: 'c0fullhash0000000000000000000000000000000',
        },
        {
          id: 'c1',
          parentIds: ['c0'],
          subject: 'Add README',
          author: 'Bob',
          timestamp: 1719000000000,
          references: [],
          fullHash: 'c1fullhash0000000000000000000000000000000',
        },
      ],
      hasMore: true,
      nextCursor: 'cursor-1',
      headCommit: 'c0fullhash0000000000000000000000000000000',
    }

    const appendPage = {
      items: [
        {
          id: 'c2',
          parentIds: ['c1'],
          subject: 'Add gitignore',
          author: 'Chris',
          timestamp: 1718000000000,
          references: [],
          fullHash: 'c2fullhash0000000000000000000000000000000',
        },
        {
          id: 'c3',
          parentIds: ['c2'],
          subject: 'Add CI workflow',
          author: 'Dana',
          timestamp: 1717000000000,
          references: [],
          fullHash: 'c3fullhash0000000000000000000000000000000',
        },
      ],
      hasMore: true,
      nextCursor: 'cursor-2',
      headCommit: 'c0fullhash0000000000000000000000000000000',
    }

    const refreshPage = {
      items: [
        {
          id: 'c-new',
          parentIds: ['c0'],
          subject: 'Hotfix',
          author: 'Eve',
          timestamp: 1721000000000,
          references: [],
          fullHash: 'cnewfullhash00000000000000000000000000000',
        },
        ...firstPage.items,
      ],
      hasMore: true,
      nextCursor: 'cursor-1',
      headCommit: 'cnewfullhash00000000000000000000000000000',
    }

    mockInvoke
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(appendPage)
      .mockResolvedValueOnce(refreshPage)

    let latestApi: ReturnType<typeof useGitHistory> | null = null
    let currentSnapshot: ReturnType<typeof useGitHistory>['snapshot'] = null

    render(
      <GitHistoryProvider>
        <HistoryHarness
          repoPath="/repo/project"
          onReady={value => {
            latestApi = value
            currentSnapshot = value.snapshot
          }}
        />
      </GitHistoryProvider>
    )

    await waitFor(() => {
      expect(latestApi).not.toBeNull()
    })

    await act(async () => {
      await latestApi!.ensureLoaded()
    })

    expect(mockInvoke).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(currentSnapshot?.items?.length).toBe(2)
    })

    const appendCursor = currentSnapshot?.nextCursor
    expect(appendCursor).toBe('cursor-1')

    await act(async () => {
      await latestApi!.loadMore(appendCursor)
    })

    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(mockInvoke).toHaveBeenNthCalledWith(
      2,
      TauriCommands.GetGitGraphHistory,
      expect.objectContaining({ cursor: 'cursor-1' })
    )

    await act(async () => {
      await latestApi!.refresh()
    })

    expect(mockInvoke).toHaveBeenCalledTimes(3)

    await waitFor(() => {
      expect((logger.debug as unknown as vi.Mock)).toHaveBeenCalledWith(
        '[GitHistoryContext] Preserving advanced cursor after refresh',
        expect.objectContaining({
          repoPath: '/repo/project',
          mergedCursor: 'cursor-2',
          hadOlderItems: true,
        })
      )
    })
  })

  it('clears the cursor after the backend signals pagination is exhausted', async () => {
    const appendedSnapshot = {
      items: [
        {
          id: 'c0',
          parentIds: [],
          subject: 'Initial commit',
          author: 'Alice',
          timestamp: 1720000000000,
          references: [],
          fullHash: 'c0fullhash0000000000000000000000000000000',
        },
        {
          id: 'c1',
          parentIds: ['c0'],
          subject: 'Older commit',
          author: 'Bob',
          timestamp: 1719000000000,
          references: [],
          fullHash: 'c1fullhash0000000000000000000000000000000',
        },
      ],
      hasMore: true,
      nextCursor: 'cursor-2',
      headCommit: 'c0fullhash0000000000000000000000000000000',
    }

    const duplicatePage = {
      ...appendedSnapshot,
      hasMore: false,
      nextCursor: undefined,
    }

    mockInvoke
      .mockResolvedValueOnce(appendedSnapshot)
      .mockResolvedValueOnce(duplicatePage)

    let latestApi: ReturnType<typeof useGitHistory> | null = null
    let currentSnapshot: ReturnType<typeof useGitHistory>['snapshot'] = null

    render(
      <GitHistoryProvider>
        <HistoryHarness
          repoPath="/repo/project"
          onReady={value => {
            latestApi = value
            currentSnapshot = value.snapshot
          }}
        />
      </GitHistoryProvider>
    )

    await waitFor(() => {
      expect(latestApi).not.toBeNull()
    })

    await act(async () => {
      await latestApi!.ensureLoaded()
    })

    await waitFor(() => {
      expect(latestApi?.snapshot?.items?.length).toBe(2)
      expect(latestApi?.snapshot?.nextCursor).toBe('cursor-2')
    })

    await act(async () => {
      await latestApi!.loadMore('cursor-2')
    })

    expect(mockInvoke).toHaveBeenNthCalledWith(
      2,
      TauriCommands.GetGitGraphHistory,
      expect.objectContaining({ cursor: 'cursor-2' })
    )

    await waitFor(() => {
      expect((logger.debug as unknown as vi.Mock)).toHaveBeenCalledWith(
        '[GitHistoryContext] Append delivered duplicate page, clearing cursor after backend exhausted history',
        expect.objectContaining({
          previousCursor: 'cursor-2',
          repoPath: '/repo/project',
        })
      )
    })
  })
})
