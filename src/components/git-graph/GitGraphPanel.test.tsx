import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { GitGraphPanel } from './GitGraphPanel'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'

declare global {
  // eslint-disable-next-line no-var
  var ResizeObserver: typeof globalThis.ResizeObserver
}

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ projectPath: '/repo/path' })
}))

vi.mock('../../common/toast/ToastProvider', () => ({
  useToast: () => ({ pushToast: vi.fn() })
}))

describe('GitGraphPanel commit details', () => {
  const mockedInvoke = vi.mocked(invoke)

  beforeEach(() => {
    mockedInvoke.mockReset()
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
})
