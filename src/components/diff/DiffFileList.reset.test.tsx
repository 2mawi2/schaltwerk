import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DiffFileList } from './DiffFileList'
import { TauriCommands } from '../../common/tauriCommands'
import { TestProviders, createChangedFile } from '../../tests/test-utils'
import { useProject } from '../../contexts/ProjectContext'
import { useSelection } from '../../contexts/SelectionContext'
import React, { useEffect } from 'react'

const invokeMock = vi.fn(async (cmd: string) => {
  if (cmd === TauriCommands.SchaltwerkCoreListEnrichedSessions) {
    return [
      {
        info: {
          session_id: 'demo',
          branch: 'feature/demo',
          base_branch: 'main',
          worktree_path: '/tmp/demo',
          status: 'active',
          is_current: false,
          session_type: 'worktree',
          session_state: 'running',
          ready_to_merge: false,
          diff_stats: { files_changed: 1, additions: 1, deletions: 0, insertions: 1 },
        },
        terminals: [],
      },
    ]
  }
  if (cmd === TauriCommands.GetChangedFilesFromMain) {
    return [
      createChangedFile({
        path: 'test.txt',
        change_type: 'added',
        additions: 1,
        deletions: 0,
        changes: 1,
      }),
    ]
  }
  if (cmd === TauriCommands.GetCurrentBranchName) return 'schaltwerk/feature'
  if (cmd === TauriCommands.GetBaseBranchName) return 'main'
  if (cmd === TauriCommands.GetCommitComparisonInfo) return ['abc', 'def']
  if (cmd === TauriCommands.GetProjectSessionsSettings) return { filter_mode: 'all', sort_mode: 'name' }
  if (cmd === TauriCommands.SetProjectSessionsSettings) return undefined
  if (cmd === TauriCommands.SchaltwerkCoreResetSessionWorktree) return undefined
  if (cmd === TauriCommands.StartFileWatcher) return undefined
  if (cmd === TauriCommands.StopFileWatcher) return undefined
  return null
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args as [string]) }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {})
}))


function ContextInitializer({ children }: { children: React.ReactNode }) {
  const { setProjectPath } = useProject()
  const { setSelection } = useSelection()

  useEffect(() => {
    setProjectPath('/test/project')
    setSelection({ kind: 'session', payload: 'demo', sessionState: 'running' })
  }, [setProjectPath, setSelection])

  return <>{children}</>
}

describe('DiffFileList header reset button', () => {
  beforeEach(() => {
    // @ts-ignore
    global.confirm = vi.fn(() => true)
    vi.clearAllMocks()
  })

  it('renders icon button for session and triggers unified confirm flow', async () => {
    render(
      <TestProviders>
        <ContextInitializer>
          <DiffFileList onFileSelect={() => {}} />
        </ContextInitializer>
      </TestProviders>
    )
    await screen.findByText('test.txt')
    const btn = await screen.findByRole('button', { name: /reset session/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    // Wait for the confirmation dialog to appear, then find the Reset button in it
    await screen.findByText('Reset Session Worktree')
    const confirmButtons = screen.getAllByRole('button', { name: /^Reset$/ })
    const confirmButton = confirmButtons[confirmButtons.length - 1]
    fireEvent.click(confirmButton)
    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreResetSessionWorktree, expect.any(Object))
  })
})
