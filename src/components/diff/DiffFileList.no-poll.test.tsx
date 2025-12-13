import { render, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiffFileList } from './DiffFileList'
import { TauriCommands } from '../../common/tauriCommands'
import { TestProviders } from '../../tests/test-utils'

const invokeMock = vi.fn(async (cmd: string) => {
  if (cmd === TauriCommands.GetChangedFilesFromMain) return []
  if (cmd === TauriCommands.GetCurrentBranchName) return 'schaltwerk/feature'
  if (cmd === TauriCommands.GetBaseBranchName) return 'main'
  if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc', 'def']
  if (cmd === TauriCommands.SchaltwerkCoreGetSession) return { original_parent_branch: 'main' }
  if (cmd === TauriCommands.StartFileWatcher) {
    throw {
      type: 'IoError',
      data: {
        operation: 'start_watching_session',
        path: '/tmp/project/.schaltwerk/specs/nervous_colden',
        message: 'Failed to start watching /tmp/project/.schaltwerk/specs/nervous_colden: No path was found.',
      },
    }
  }
  if (cmd === TauriCommands.StopFileWatcher) return undefined
  return null
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args as [string]) }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {})
}))

vi.mock('../../hooks/useSelection', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../hooks/useSelection')
  return {
    ...actual,
    useSelection: () => ({
      selection: { kind: 'session', payload: 'demo', sessionState: 'running' },
      terminals: { top: 'session-demo-top', bottomBase: 'session-demo-bottom', workingDirectory: '/tmp' },
      setSelection: vi.fn(),
      clearTerminalTracking: vi.fn(),
      isReady: true,
      isSpec: false,
    })
  }
})

describe('DiffFileList missing worktree watcher handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not fall back to polling when start_file_watcher fails due to a missing path', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    try {
      render(
        <TestProviders>
          <DiffFileList onFileSelect={() => {}} />
        </TestProviders>
      )

      for (let i = 0; i < 10; i++) {
        await act(async () => {
          await Promise.resolve()
        })
        if (invokeMock.mock.calls.some(([cmd]) => cmd === TauriCommands.StartFileWatcher)) break
      }

      expect(invokeMock.mock.calls.some(([cmd]) => cmd === TauriCommands.StartFileWatcher)).toBe(true)
      expect(setIntervalSpy).not.toHaveBeenCalled()
    } finally {
      setIntervalSpy.mockRestore()
    }
  })
})

