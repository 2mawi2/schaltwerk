import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { GitGraphPanel } from './GitGraphPanel'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { SchaltEvent } from '../../common/eventSystem'

declare global {
  var ResizeObserver: typeof globalThis.ResizeObserver
}

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ projectPath: '/repo/path' })
}))

vi.mock('../../common/toast/ToastProvider', () => ({
  useToast: () => ({ pushToast: vi.fn() })
}))

const fileChangeHandlers: Record<string, (payload: unknown) => unknown> = {}

vi.mock('../../common/eventSystem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../common/eventSystem')>()
  return {
    ...actual,
    listenEvent: vi.fn(async (event, handler) => {
      fileChangeHandlers[event] = handler as (payload: unknown) => unknown
      return () => {
        delete fileChangeHandlers[event]
      }
    })
  }
})

describe('GitGraphPanel commit details', () => {
  const mockedInvoke = vi.mocked(invoke)

  beforeEach(() => {
    mockedInvoke.mockReset()
    Object.keys(fileChangeHandlers).forEach((key) => {
      delete fileChangeHandlers[key]
    })
    class MockResizeObserver {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe() {
        // Immediately invoke callback with synthetic size so virtual list renders
        this.callback([{ contentRect: { height: 600 } } as ResizeObserverEntry], this)
      }
      unobserve() {}
      disconnect() {}
    }
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
  })

  it('loads and toggles commit file details on demand', async () => {
    const historyResponse = {
      items: [
        {
          id: 'abc1234',
          parentIds: ['fffffff'],
          subject: 'Add git graph dropdown',
          author: 'Alice',
          timestamp: 1720000000000,
          references: [],
          fullHash: 'abc1234fffffffabc1234fffffffabc1234fffffff',
        },
      ],
      hasMore: false,
      nextCursor: null,
    }

    const filesResponse = [
      { path: 'src/main.rs', changeType: 'M' },
      { path: 'src/utils/git.rs', changeType: 'A' },
    ]

    mockedInvoke.mockImplementation(async (command, payload) => {
      if (command === TauriCommands.GetGitGraphHistory) {
        expect(payload).toMatchObject({ repoPath: '/repo/path' })
        return historyResponse as unknown
      }

      if (command === TauriCommands.GetGitGraphCommitFiles) {
        expect(payload).toMatchObject({ repoPath: '/repo/path', commitHash: 'abc1234fffffffabc1234fffffffabc1234fffffff' })
        return filesResponse as unknown
      }

      throw new Error(`Unexpected command ${String(command)}`)
    })

    render(<GitGraphPanel />)

    const commitRow = await screen.findByText('Add git graph dropdown')

    await userEvent.click(commitRow)

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        TauriCommands.GetGitGraphCommitFiles,
        expect.objectContaining({ commitHash: 'abc1234fffffffabc1234fffffffabc1234fffffff' })
      )
    })

    await screen.findByText('main.rs')
    expect(screen.getByTestId('git-graph-extension')).toBeInTheDocument()

    await userEvent.click(commitRow)

    await waitFor(() => {
      expect(screen.queryByText('main.rs')).not.toBeInTheDocument()
    })
  })

  it('invokes onOpenCommitDiff when a file row is activated', async () => {
    const historyResponse = {
      items: [
        {
          id: 'abc1234',
          parentIds: ['fffffff'],
          subject: 'Initial commit',
          author: 'Alice',
          timestamp: 1720000000000,
          references: [],
          fullHash: 'abc1234fffffffabc1234fffffffabc1234fffffff',
        },
      ],
      hasMore: false,
      nextCursor: null,
    }

    const filesResponse = [
      { path: 'src/main.rs', changeType: 'M' },
      { path: 'README.md', changeType: 'A' },
    ]

    mockedInvoke.mockImplementation(async (command: string, payload: unknown) => {
      if (command === TauriCommands.GetGitGraphHistory) {
        expect(payload).toMatchObject({ repoPath: '/repo/path' })
        return historyResponse as unknown
      }

      if (command === TauriCommands.GetGitGraphCommitFiles) {
        return filesResponse as unknown
      }

      throw new Error(`Unexpected command ${String(command)}`)
    })

    const handleOpenCommitDiff = vi.fn()
    render(<GitGraphPanel onOpenCommitDiff={handleOpenCommitDiff} />)

    const commitRow = await screen.findByText('Initial commit')
    await userEvent.click(commitRow)

    const fileRow = await screen.findByText('main.rs')
    await userEvent.click(fileRow)

    await waitFor(() => {
      expect(handleOpenCommitDiff).toHaveBeenCalled()
    })

    const payload = handleOpenCommitDiff.mock.calls[0][0]
    expect(payload.repoPath).toBe('/repo/path')
    expect(payload.commit.subject).toBe('Initial commit')
    expect(payload.files).toEqual(filesResponse)
    expect(payload.initialFilePath).toBe('src/main.rs')
  })

  it('reloads history when head commit changes and ignores duplicate events', async () => {
    const historyResponse = {
      items: [
        {
          id: 'abc1234',
          parentIds: ['fffffff'],
          subject: 'Initial commit',
          author: 'Alice',
          timestamp: 1720000000000,
          references: [],
          fullHash: 'abc1234fffffffabc1234fffffffabc1234fffffff',
        },
      ],
      hasMore: false,
      nextCursor: null,
    }

    mockedInvoke.mockImplementation(async (command, payload) => {
      if (command === TauriCommands.GetGitGraphHistory) {
        expect(payload).toMatchObject({ repoPath: '/repo/path' })
        return historyResponse as unknown
      }
      if (command === TauriCommands.GetGitGraphCommitFiles) {
        return []
      }
      throw new Error(`Unexpected command ${String(command)}`)
    })

    render(<GitGraphPanel />)

    await screen.findByText('Initial commit')
    expect(mockedInvoke).toHaveBeenCalledWith(
      TauriCommands.GetGitGraphHistory,
      expect.objectContaining({ repoPath: '/repo/path', cursor: undefined })
    )

    const handler = fileChangeHandlers[SchaltEvent.FileChanges]
    expect(handler).toBeDefined()

    mockedInvoke.mockImplementationOnce(async (command, payload) => {
      if (command === TauriCommands.GetGitGraphHistory) {
        expect(payload).toMatchObject({ repoPath: '/repo/path' })
        return {
          ...historyResponse,
          items: [
            {
              id: 'def5678',
              parentIds: ['abc1234'],
              subject: 'Add new feature',
              author: 'Bob',
              timestamp: 1720000100000,
              references: [],
              fullHash: 'def5678abc1234def5678abc1234def5678abc1234',
            },
            {
              ...historyResponse.items[0],
            },
          ],
        } as unknown
      }
      if (command === TauriCommands.GetGitGraphCommitFiles) {
        return []
      }
      throw new Error(`Unexpected command ${String(command)}`)
    })

    await act(async () => {
      await handler?.({
        session_name: 'session-1',
        changed_files: [],
        branch_info: {
          current_branch: 'feature/new',
          base_branch: 'main',
          base_commit: 'abc1111',
          head_commit: 'def5678',
        },
      })
    })

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith(
        TauriCommands.GetGitGraphHistory,
        expect.objectContaining({ repoPath: '/repo/path' })
      )
    })
    expect(mockedInvoke).toHaveBeenCalledTimes(2)

    await act(async () => {
      await handler?.({
        session_name: 'session-1',
        changed_files: [],
        branch_info: {
          current_branch: 'feature/new',
          base_branch: 'main',
          base_commit: 'abc1111',
          head_commit: 'def5678',
        },
      })
    })

    expect(mockedInvoke).toHaveBeenCalledTimes(2)
  })
})
