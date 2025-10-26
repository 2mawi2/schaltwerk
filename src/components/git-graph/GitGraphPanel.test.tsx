import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { SchaltEvent } from '../../common/eventSystem'
import type { HistoryProviderSnapshot } from './types'
import { GitGraphPanel } from './GitGraphPanel'
import { logger } from '../../utils/logger'

const useGitHistoryMock = vi.fn()

const { fileChangeHandlers, defaultListenImplementation, listenEventMock } = vi.hoisted(() => {
  const handlers: Record<string, (payload: unknown) => unknown> = {}
  const defaultImpl = async (event: string, handler: (payload: unknown) => unknown) => {
    handlers[event] = handler
    return () => {
      delete handlers[event]
    }
  }

  return {
    fileChangeHandlers: handlers,
    defaultListenImplementation: defaultImpl,
    listenEventMock: vi.fn(defaultImpl)
  }
})

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ projectPath: '/repo/path' })
}))

vi.mock('../../common/toast/ToastProvider', () => ({
  useToast: () => ({ pushToast: vi.fn() })
}))

vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('../../common/eventSystem', async importOriginal => {
  const actual = await importOriginal<typeof import('../../common/eventSystem')>()
  return {
    ...actual,
    listenEvent: listenEventMock
  }
})

vi.mock('../../contexts/GitHistoryContext', () => ({
  useGitHistory: (repoPath?: string | null) => useGitHistoryMock(repoPath ?? null)
}))

const mockedInvoke = vi.mocked(invoke)

const baseSnapshot: HistoryProviderSnapshot = {
  items: [
    {
      id: 'abc1234',
      parentIds: [],
      subject: 'Initial commit',
      author: 'Alice',
      timestamp: 1720000000000,
      references: [],
      fullHash: 'abc1234fffffffabc1234fffffffabc1234fffffff'
    }
  ],
  hasMore: false,
  nextCursor: undefined,
  headCommit: 'abc1234fffffffabc1234fffffffabc1234fffffff'
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedInvoke.mockReset()
  useGitHistoryMock.mockReset()
  listenEventMock.mockReset()
  listenEventMock.mockImplementation(defaultListenImplementation)
  Object.keys(fileChangeHandlers).forEach(key => {
    delete fileChangeHandlers[key]
  })

  class MockResizeObserver {
    callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }
    observe() {
      this.callback([{ contentRect: { height: 600 } } as ResizeObserverEntry], this)
    }
    unobserve() {}
    disconnect() {}
  }
  global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
})

describe('GitGraphPanel', () => {
  it('renders commits and toggles file details on demand', async () => {
    const ensureLoadedMock = vi.fn()
    const snapshot: HistoryProviderSnapshot = {
      ...baseSnapshot,
      items: [
        {
          ...baseSnapshot.items[0],
          subject: 'Add git graph dropdown'
        }
      ]
    }

    useGitHistoryMock.mockReturnValue({
      snapshot,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: snapshot.headCommit ?? null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: vi.fn()
    })

    const filesResponse = [
      { path: 'src/main.rs', changeType: 'M' },
      { path: 'src/utils/git.rs', changeType: 'A' }
    ]

    mockedInvoke.mockImplementation(async (command, payload) => {
      if (command === TauriCommands.GetGitGraphHistory) {
        return snapshot as unknown
      }
      if (command === TauriCommands.GetGitGraphCommitFiles) {
        expect(payload).toMatchObject({ repoPath: '/repo/path', commitHash: snapshot.items[0].fullHash })
        return filesResponse as unknown
      }
      throw new Error(`Unexpected command ${String(command)}`)
    })

    render(<GitGraphPanel />)

    expect(ensureLoadedMock).toHaveBeenCalled()
    expect(screen.getByText('Add git graph dropdown')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Add git graph dropdown'))
    await screen.findByText('main.rs')

    expect(mockedInvoke).toHaveBeenCalledWith(
      TauriCommands.GetGitGraphCommitFiles,
      expect.objectContaining({ commitHash: snapshot.items[0].fullHash })
    )

    await userEvent.click(screen.getByText('Add git graph dropdown'))
    expect(screen.queryByText('main.rs')).not.toBeInTheDocument()
  })

  it('invokes onOpenCommitDiff when a file row is activated', async () => {
    const ensureLoadedMock = vi.fn()

    useGitHistoryMock.mockReturnValue({
      snapshot: baseSnapshot,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: baseSnapshot.headCommit ?? null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: vi.fn()
    })

    const filesResponse = [
      { path: 'src/main.rs', changeType: 'M' },
      { path: 'README.md', changeType: 'A' }
    ]

    mockedInvoke.mockImplementation(async command => {
      if (command === TauriCommands.GetGitGraphHistory) {
        return baseSnapshot as unknown
      }
      if (command === TauriCommands.GetGitGraphCommitFiles) {
        return filesResponse as unknown
      }
      throw new Error(`Unexpected command ${String(command)}`)
    })

    const handleOpenCommitDiff = vi.fn()
    render(<GitGraphPanel onOpenCommitDiff={handleOpenCommitDiff} />)

    expect(ensureLoadedMock).toHaveBeenCalled()

    await userEvent.click(screen.getByText('Initial commit'))
    await userEvent.click(screen.getByText('main.rs'))

    expect(handleOpenCommitDiff).toHaveBeenCalledTimes(1)
    const payload = handleOpenCommitDiff.mock.calls[0][0]
    expect(payload.repoPath).toBe('/repo/path')
    expect(payload.files).toEqual(filesResponse)
    expect(payload.initialFilePath).toBe('src/main.rs')
  })

  it('refreshes history when file change events report a new head', async () => {
    const ensureLoadedMock = vi.fn()
    const refreshMock = vi.fn()

    useGitHistoryMock.mockReturnValue({
      snapshot: baseSnapshot,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: baseSnapshot.headCommit ?? null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: refreshMock
    })

    mockedInvoke.mockResolvedValue(baseSnapshot as unknown)

    render(<GitGraphPanel sessionName="session-1" />)

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled()
    })
    refreshMock.mockClear()

    const handler = fileChangeHandlers[SchaltEvent.FileChanges]
    expect(handler).toBeDefined()

    const newHead = 'def5678abc1234def5678abc1234def5678abc1234'

    await handler?.({
      session_name: 'session-1',
      branch_info: {
        current_branch: 'feature/new',
        base_branch: 'main',
        base_commit: 'abc1111',
        head_commit: newHead
      }
    })

    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('eagerly refreshes after ensureLoaded to capture external commits', async () => {
    const ensureLoadedMock = vi.fn().mockResolvedValue(undefined)
    const refreshMock = vi.fn().mockResolvedValue(undefined)

    useGitHistoryMock.mockReturnValue({
      snapshot: baseSnapshot,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: baseSnapshot.headCommit ?? null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: refreshMock
    })

    render(<GitGraphPanel />)

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled()
    })

    expect(ensureLoadedMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes when the panel receives user interaction', async () => {
    const ensureLoadedMock = vi.fn().mockResolvedValue(undefined)
    const refreshMock = vi.fn().mockResolvedValue(undefined)

    useGitHistoryMock.mockReturnValue({
      snapshot: baseSnapshot,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: baseSnapshot.headCommit ?? null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: refreshMock
    })

    const user = userEvent.setup()
    render(<GitGraphPanel />)

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled()
    })

    refreshMock.mockClear()

    await waitFor(() => {
      expect(ensureLoadedMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(ensureLoadedMock).toHaveBeenCalled()
    })

    refreshMock.mockClear()

    await user.click(screen.getByTestId('git-history-panel'))

    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes when watcher emits after orchestrator mount (simulated commit)', async () => {
    const ensureLoadedMock = vi.fn().mockResolvedValue(undefined)
    const refreshMock = vi.fn().mockResolvedValue(undefined)

    useGitHistoryMock.mockReturnValue({
      snapshot: baseSnapshot,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: baseSnapshot.headCommit ?? null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: refreshMock
    })

    mockedInvoke.mockResolvedValue(baseSnapshot as unknown)

    render(<GitGraphPanel />)

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled()
    })
    refreshMock.mockClear()

    const handler = fileChangeHandlers[SchaltEvent.FileChanges]
    expect(handler).toBeDefined()

    await handler?.({
      session_name: 'orchestrator',
      branch_info: {
        current_branch: 'main',
        base_branch: 'main',
        base_commit: 'abc0000',
        head_commit: 'abc0000ffffeeee1111222233334444aaaa5555'
      }
    })

    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('should refresh when watcher emits before snapshot (currently failing)', async () => {
    const ensureLoadedMock = vi.fn().mockResolvedValue(undefined)
    const refreshMock = vi.fn().mockResolvedValue(undefined)

    useGitHistoryMock.mockReturnValue({
      snapshot: null,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: refreshMock
    })

    mockedInvoke.mockResolvedValue(baseSnapshot as unknown)

    render(<GitGraphPanel />)

    await waitFor(() => {
      expect(ensureLoadedMock).toHaveBeenCalled()
    })

    refreshMock.mockClear()

    const handler = fileChangeHandlers[SchaltEvent.FileChanges]
    expect(handler).toBeDefined()

    await handler?.({
      session_name: 'orchestrator',
      branch_info: {
        current_branch: 'main',
        base_branch: 'main',
        base_commit: 'abc0000',
        head_commit: 'abc0000ffffeeee1111222233334444bbbb5555'
      }
    })

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled()
    })
  })

  it('does not queue other sessions during bootstrap', async () => {
    let resolveEnsure: (() => void) | undefined

    const ensureLoadedMock = vi.fn(() => new Promise<void>(resolve => {
      resolveEnsure = resolve
    }))
    const refreshMock = vi.fn().mockResolvedValue(undefined)

    useGitHistoryMock.mockReturnValue({
      snapshot: null,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: refreshMock
    })

    render(<GitGraphPanel />)

    const handler = fileChangeHandlers[SchaltEvent.FileChanges]
    expect(handler).toBeDefined()

    await handler?.({
      session_name: 'session-other',
      branch_info: {
        current_branch: 'feature/other',
        base_branch: 'main',
        base_commit: 'abc0000',
        head_commit: 'ffeeddccbbaa99887766554433221100cc'
      }
    })

    expect(refreshMock).not.toHaveBeenCalled()

    resolveEnsure?.()

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1)
    })

    await new Promise(resolve => setTimeout(resolve, 10))
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('keeps showing history while a background refresh is loading', async () => {
    const ensureLoadedMock = vi.fn().mockResolvedValue(undefined)
    const refreshMock = vi.fn().mockResolvedValue(undefined)

    useGitHistoryMock.mockReturnValue({
      snapshot: baseSnapshot,
      isLoading: true,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: baseSnapshot.headCommit ?? null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: refreshMock
    })

    render(<GitGraphPanel />)

    expect(await screen.findByText('Initial commit')).toBeInTheDocument()
    expect(screen.queryByText('Loading git history...')).not.toBeInTheDocument()
  })

  it('uses override repo path and ignores events for other sessions', async () => {
    const ensureLoadedMock = vi.fn()
    const refreshMock = vi.fn()
    const overrideSnapshot: HistoryProviderSnapshot = {
      ...baseSnapshot,
      items: [
        {
          ...baseSnapshot.items[0],
          subject: 'Session commit'
        }
      ]
    }

    useGitHistoryMock.mockImplementation((repoPath: string | null) => {
      expect(repoPath).toBe('/sessions/test-session')
      return {
        snapshot: overrideSnapshot,
        isLoading: false,
        error: null,
        isLoadingMore: false,
        loadMoreError: null,
        latestHead: overrideSnapshot.headCommit ?? null,
        ensureLoaded: ensureLoadedMock,
        loadMore: vi.fn(),
        refresh: refreshMock
      }
    })

    mockedInvoke.mockResolvedValue(overrideSnapshot as unknown)

    render(<GitGraphPanel repoPath="/sessions/test-session" sessionName="session-1" />)

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled()
    })
    refreshMock.mockClear()

    const handler = fileChangeHandlers[SchaltEvent.FileChanges]
    expect(handler).toBeDefined()

    await handler?.({
      session_name: 'session-2',
      branch_info: {
        current_branch: 'feature/other',
        base_branch: 'main',
        base_commit: 'abc0000',
        head_commit: 'def9999'
      }
    })

    expect(refreshMock).not.toHaveBeenCalled()

    await handler?.({
      session_name: 'session-1',
      branch_info: {
        current_branch: 'feature/session',
        base_branch: 'main',
        base_commit: 'abc0000',
        head_commit: 'def5678abc1234def5678abc1234def5678abc1234'
      }
    })

    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes when orchestrator file change events arrive', async () => {
    const ensureLoadedMock = vi.fn()
    const refreshMock = vi.fn()

    useGitHistoryMock.mockReturnValue({
      snapshot: baseSnapshot,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: baseSnapshot.headCommit ?? null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: refreshMock
    })

    mockedInvoke.mockResolvedValue(baseSnapshot as unknown)

    render(<GitGraphPanel />)

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled()
    })
    refreshMock.mockClear()

    const handler = fileChangeHandlers[SchaltEvent.FileChanges]
    expect(handler).toBeDefined()

    await handler?.({
      session_name: 'orchestrator',
      branch_info: {
        current_branch: 'main',
        base_branch: 'main',
        base_commit: 'abc0000',
        head_commit: 'ffeeddccbbaa99887766554433221100aa'
      }
    })

    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('ignores non-orchestrator events while orchestrator history is open', async () => {
    const ensureLoadedMock = vi.fn()
    const refreshMock = vi.fn()

    useGitHistoryMock.mockReturnValue({
      snapshot: baseSnapshot,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: baseSnapshot.headCommit ?? null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: refreshMock
    })

    mockedInvoke.mockResolvedValue(baseSnapshot as unknown)

    render(<GitGraphPanel />)

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled()
    })
    refreshMock.mockClear()

    const handler = fileChangeHandlers[SchaltEvent.FileChanges]
    expect(handler).toBeDefined()

    await handler?.({
      session_name: 'session-x',
      branch_info: {
        current_branch: 'feature/ignore',
        base_branch: 'main',
        base_commit: 'abc0000',
        head_commit: 'ffeeddccbbaa99887766554433221100aa'
      }
    })

    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('shows error state when initial history fetch fails', async () => {
    const ensureLoadedMock = vi.fn()

    useGitHistoryMock.mockReturnValue({
      snapshot: null,
      isLoading: false,
      error: 'Boom',
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: vi.fn()
    })

    render(<GitGraphPanel />)

    expect(await screen.findByText('Failed to load git history')).toBeInTheDocument()
    expect(screen.getByText('Boom')).toBeInTheDocument()
  })

  it('shows empty state before any history has loaded', async () => {
    const ensureLoadedMock = vi.fn()

    useGitHistoryMock.mockReturnValue({
      snapshot: null,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: vi.fn()
    })

    render(<GitGraphPanel />)

    expect(await screen.findByText('No git history available')).toBeInTheDocument()
  })

  it('logs and swallows errors when event unlisten rejects during cleanup', async () => {
    const ensureLoadedMock = vi.fn()

    useGitHistoryMock.mockReturnValue({
      snapshot: baseSnapshot,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: baseSnapshot.headCommit ?? null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: vi.fn()
    })

    const unlistenError = new Error('failed to unlisten')

    listenEventMock.mockImplementationOnce(async (event, handler) => {
      fileChangeHandlers[event] = handler
      return async () => {
        throw unlistenError
      }
    })

    const { unmount } = render(<GitGraphPanel />)
    expect(ensureLoadedMock).toHaveBeenCalled()

    unmount()
    await waitFor(() => {
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Ignored unlisten error'),
        unlistenError
      )
    })
  })

  it('keeps the context menu open when the same contextmenu event bubbles to the overlay', async () => {
    const ensureLoadedMock = vi.fn()
    const refreshMock = vi.fn().mockResolvedValue(undefined)

    useGitHistoryMock.mockReturnValue({
      snapshot: baseSnapshot,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: baseSnapshot.headCommit ?? null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: refreshMock
    })

    render(<GitGraphPanel />)

    await waitFor(() => {
      expect(ensureLoadedMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled()
    })

    const baselineCalls = refreshMock.mock.calls.length

    const commitRow = await screen.findByText('Initial commit')
    fireEvent.contextMenu(commitRow)

    const overlay = document.body.querySelector('.fixed.inset-0.z-40') as HTMLElement | null
    expect(overlay).not.toBeNull()
    expect(screen.queryByText('Copy commit ID')).toBeInTheDocument()

    const overlayEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    overlayEvent.preventDefault()
    overlay!.dispatchEvent(overlayEvent)

    expect(screen.queryByText('Copy commit ID')).toBeInTheDocument()

    expect(refreshMock.mock.calls.length).toBe(baselineCalls)
  })

  it('closes the context menu when the overlay receives a left click', async () => {
    const ensureLoadedMock = vi.fn()
    const refreshMock = vi.fn().mockResolvedValue(undefined)

    useGitHistoryMock.mockReturnValue({
      snapshot: baseSnapshot,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: baseSnapshot.headCommit ?? null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: refreshMock
    })

    const user = userEvent.setup()

    render(<GitGraphPanel />)

    await waitFor(() => {
      expect(ensureLoadedMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled()
    })

    const baselineCalls = refreshMock.mock.calls.length

    const commitRow = await screen.findByText('Initial commit')
    fireEvent.contextMenu(commitRow)

    const overlay = document.body.querySelector('.fixed.inset-0.z-40') as HTMLElement | null
    expect(overlay).not.toBeNull()
    expect(screen.queryByText('Copy commit ID')).toBeInTheDocument()

    await user.click(overlay!)

    expect(screen.queryByText('Copy commit ID')).not.toBeInTheDocument()
    expect(refreshMock.mock.calls.length).toBe(baselineCalls)
  })

  it('does not trigger a manual refresh when interacting with the context menu', async () => {
    const ensureLoadedMock = vi.fn()
    const refreshMock = vi.fn().mockResolvedValue(undefined)

    useGitHistoryMock.mockReturnValue({
      snapshot: baseSnapshot,
      isLoading: false,
      error: null,
      isLoadingMore: false,
      loadMoreError: null,
      latestHead: baseSnapshot.headCommit ?? null,
      ensureLoaded: ensureLoadedMock,
      loadMore: vi.fn(),
      refresh: refreshMock
    })

    const user = userEvent.setup()

    render(<GitGraphPanel />)

    await waitFor(() => {
      expect(ensureLoadedMock).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled()
    })

    const baselineCalls = refreshMock.mock.calls.length

    const commitRow = await screen.findByText('Initial commit')
    fireEvent.contextMenu(commitRow)

    expect(screen.queryByText('Copy commit ID')).toBeInTheDocument()
    expect(refreshMock.mock.calls.length).toBe(baselineCalls)

    mockedInvoke.mockResolvedValue(undefined)

    await user.click(screen.getByText('Copy commit ID'))

    expect(refreshMock.mock.calls.length).toBe(baselineCalls)
  })
})
