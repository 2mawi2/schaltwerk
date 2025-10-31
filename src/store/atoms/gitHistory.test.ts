import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import { TauriCommands } from '../../common/tauriCommands'
import {
  ensureGitHistoryLoadedActionAtom,
  gitHistoryEntryAtomFamily,
  gitHistoryFilterAtomFamily,
  filteredGitHistoryAtomFamily,
  gitHistoryEntriesAtom,
  loadMoreGitHistoryActionAtom,
  refreshGitHistoryActionAtom,
} from './gitHistory'
import type { HistoryProviderSnapshot } from '../../components/git-graph/types'

const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('gitHistory atoms', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('loads git history from the backend when ensuring a repo is loaded', async () => {
    const store = createStore()

    const snapshot: HistoryProviderSnapshot = {
      items: [
        {
          id: 'c1',
          parentIds: [],
          subject: 'Initial commit',
          author: 'Alice',
          timestamp: 1720000000000,
          references: [],
          fullHash: 'c1fullhash0000000000000000000000000000000',
        },
      ],
      hasMore: false,
      nextCursor: undefined,
      headCommit: 'c1fullhash0000000000000000000000000000000',
    }

    mockInvoke.mockResolvedValue(snapshot)

    await store.set(ensureGitHistoryLoadedActionAtom, '/repo/project')

    expect(mockInvoke).toHaveBeenCalledWith(
      TauriCommands.GetGitGraphHistory,
      expect.objectContaining({
        repoPath: '/repo/project',
        limit: 100,
        cursor: undefined,
        sinceHead: null,
      }),
    )

    const entry = store.get(gitHistoryEntryAtomFamily('/repo/project'))
    expect(entry.snapshot).not.toBeNull()
    expect(entry.snapshot?.items).toHaveLength(1)
    expect(entry.latestHead).toBe('c1fullhash0000000000000000000000000000000')
    expect(entry.isLoading).toBe(false)
    expect(entry.error).toBeNull()
  })

  it('stores filter criteria per repository', () => {
    const store = createStore()
    const filterAtom = gitHistoryFilterAtomFamily('/repo/project')

    expect(store.get(filterAtom)).toEqual({ searchText: '', author: null })

    store.set(filterAtom, { searchText: 'readme', author: null })

    expect(store.get(filterAtom)).toEqual({ searchText: 'readme', author: null })
  })

  it('derives filtered commits using the current criteria', () => {
    const store = createStore()

    const repoPath = '/repo/project'
    const snapshot: HistoryProviderSnapshot = {
      items: [
        {
          id: 'c1',
          parentIds: [],
          subject: 'Initial commit',
          author: 'Alice',
          timestamp: 1720000000000,
          references: [],
          fullHash: 'c1fullhash0000000000000000000000000000000',
        },
        {
          id: 'c2',
          parentIds: ['c1'],
          subject: 'Add README',
          author: 'Bob',
          timestamp: 1719000000000,
          references: [],
          fullHash: 'c2fullhash0000000000000000000000000000000',
        },
        {
          id: 'c3',
          parentIds: ['c2'],
          subject: 'Bump dependencies',
          author: 'Cara',
          timestamp: 1718000000000,
          references: [],
          fullHash: 'c3fullhash0000000000000000000000000000000',
        },
      ],
      hasMore: true,
      nextCursor: 'cursor-2',
      headCommit: 'c1fullhash0000000000000000000000000000000',
    }

    store.set(
      gitHistoryEntriesAtom,
      new Map([
        [repoPath, {
          snapshot,
          isLoading: false,
          isLoadingMore: false,
          error: null,
          loadMoreError: null,
          latestHead: snapshot.headCommit ?? snapshot.items[0]?.fullHash ?? null,
        }],
      ]),
    )

    store.set(gitHistoryFilterAtomFamily(repoPath), { searchText: 'readme', author: null })

    const filtered = store.get(filteredGitHistoryAtomFamily(repoPath))

    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.id).toBe('c2')
  })

  it('appends new commits and deduplicates existing ones when loading more history', async () => {
    const store = createStore()
    const repoPath = '/repo/project'

    const initialSnapshot: HistoryProviderSnapshot = {
      items: [
        {
          id: 'c0',
          parentIds: [],
          subject: 'Initial commit',
          author: 'Alice',
          timestamp: 1720000000000,
          references: [],
          fullHash: 'c0hash',
        },
        {
          id: 'c1',
          parentIds: ['c0'],
          subject: 'Add README',
          author: 'Bob',
          timestamp: 1719000000000,
          references: [],
          fullHash: 'c1hash',
        },
      ],
      hasMore: true,
      nextCursor: 'cursor-1',
      headCommit: 'c0hash',
    }

    const appendSnapshot: HistoryProviderSnapshot = {
      items: [
        {
          id: 'c2',
          parentIds: ['c1'],
          subject: 'Add gitignore',
          author: 'Cara',
          timestamp: 1718000000000,
          references: [],
          fullHash: 'c2hash',
        },
        {
          id: 'c1',
          parentIds: ['c0'],
          subject: 'Add README',
          author: 'Bob',
          timestamp: 1719000000000,
          references: [],
          fullHash: 'c1hash',
        },
      ],
      hasMore: true,
      nextCursor: 'cursor-2',
      headCommit: 'c0hash',
    }

    mockInvoke
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(appendSnapshot)

    await store.set(ensureGitHistoryLoadedActionAtom, repoPath)
    await store.set(loadMoreGitHistoryActionAtom, { repoPath, cursor: 'cursor-1' })

    const entry = store.get(gitHistoryEntryAtomFamily(repoPath))
    expect(entry.snapshot?.items.map(item => item.id)).toEqual(['c0', 'c1', 'c2'])
    expect(entry.snapshot?.nextCursor).toBe('cursor-2')
    expect(entry.isLoadingMore).toBe(false)
    expect(entry.loadMoreError).toBeNull()
  })

  it('passes the latest head when refreshing history', async () => {
    const store = createStore()
    const repoPath = '/repo/project'
    const head = 'c0hash'

    const initialSnapshot: HistoryProviderSnapshot = {
      items: [
        {
          id: 'c0',
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
    }

    const refreshSnapshot: HistoryProviderSnapshot = {
      items: [],
      hasMore: false,
      nextCursor: undefined,
      headCommit: head,
      unchanged: true,
    }

    mockInvoke
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(refreshSnapshot)

    await store.set(ensureGitHistoryLoadedActionAtom, repoPath)
    await store.set(refreshGitHistoryActionAtom, repoPath)

    expect(mockInvoke).toHaveBeenNthCalledWith(
      2,
      TauriCommands.GetGitGraphHistory,
      expect.objectContaining({
        repoPath,
        sinceHead: head,
        limit: 100,
      }),
    )
  })

  it('captures load more errors without leaving the entry in a loading state', async () => {
    const store = createStore()
    const repoPath = '/repo/project'

    store.set(
      gitHistoryEntriesAtom,
      new Map([
        [repoPath, {
          snapshot: {
            items: [
              {
                id: 'c0',
                parentIds: [],
                subject: 'Initial commit',
                author: 'Alice',
                timestamp: 1720000000000,
                references: [],
                fullHash: 'c0hash',
              },
            ],
            hasMore: true,
            nextCursor: 'cursor-1',
            headCommit: 'c0hash',
          },
          isLoading: false,
          isLoadingMore: false,
          error: null,
          loadMoreError: null,
          latestHead: 'c0hash',
        }],
      ]),
    )

    mockInvoke.mockRejectedValueOnce(new Error('network down'))

    await store.set(loadMoreGitHistoryActionAtom, { repoPath, cursor: 'cursor-1' })

    const entry = store.get(gitHistoryEntryAtomFamily(repoPath))
    expect(entry.isLoadingMore).toBe(false)
    expect(entry.loadMoreError).toBe('network down')
  })
})
