import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { TestProviders, createChangedFile } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import type { FileDiffData } from './loadDiffs'

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args)
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

const changedFiles = [
  createChangedFile({ path: 'tests/Button.test.tsx', change_type: 'modified', additions: 10, deletions: 5 }),
  createChangedFile({ path: 'src/utils/helpers.ts', change_type: 'modified', additions: 3, deletions: 1 }),
  createChangedFile({ path: 'src/components/Button.tsx', change_type: 'modified', additions: 5, deletions: 2 }),
  createChangedFile({ path: 'src/components/Input.tsx', change_type: 'added', additions: 20, deletions: 0 }),
]

function createDiffForFile(path: string): FileDiffData {
  return {
    file: changedFiles.find(f => f.path === path) ?? createChangedFile({ path, change_type: 'modified' }),
    diffResult: [
      { type: 'unchanged', oldLineNumber: 1, newLineNumber: 1, content: 'const a = 1' },
      { type: 'added', newLineNumber: 2, content: 'const b = 2' },
    ],
    changedLinesCount: 1,
    fileInfo: { sizeBytes: 12, language: 'typescript' }
  }
}

const loadFileDiffMock = vi.fn(async (_session: string, file: { path: string }) => createDiffForFile(file.path))

vi.mock('./loadDiffs', async () => {
  const actual = await vi.importActual<typeof import('./loadDiffs')>('./loadDiffs')
  return {
    ...actual,
    loadFileDiff: (...args: Parameters<typeof loadFileDiffMock>) => loadFileDiffMock(...args),
    loadCommitFileDiff: vi.fn()
  }
})

function setupInvokeMock() {
  invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
    switch (cmd) {
      case TauriCommands.GetChangedFilesFromMain:
        return changedFiles
      case TauriCommands.GetCurrentBranchName:
        return 'feature/demo'
      case TauriCommands.GetBaseBranchName:
        return 'main'
      case TauriCommands.GetCommitComparisonInfo:
        return ['abc123', 'def456']
      case TauriCommands.GetDiffViewPreferences:
        return { continuous_scroll: false, compact_diffs: true, sidebar_width: 320 }
      case TauriCommands.GetSessionPreferences:
        return { skip_confirmation_modals: false }
      case TauriCommands.ListAvailableOpenApps:
        return []
      case TauriCommands.GetDefaultOpenApp:
        return 'code'
      case TauriCommands.GetProjectSettings:
        return { project_name: 'demo', project_path: '/tmp/demo' }
      default:
        throw new Error(`Unhandled invoke: ${cmd} ${JSON.stringify(args)}`)
    }
  })
}

beforeEach(() => {
  invokeMock.mockReset()
  loadFileDiffMock.mockClear()
})

describe('UnifiedDiffModal keyboard navigation', () => {
  it('navigates through files in visual tree order with ArrowDown (folders first, alphabetically)', async () => {
    setupInvokeMock()

    render(
      <TestProviders>
        <UnifiedDiffModal filePath="src/components/Button.tsx" isOpen={true} onClose={() => {}} />
      </TestProviders>
    )

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.GetChangedFilesFromMain, { sessionName: 'demo' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('src/components/Button.tsx')
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowDown' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('src/components/Input.tsx')
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowDown' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('src/utils/helpers.ts')
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowDown' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('tests/Button.test.tsx')
    })
  })

  it('navigates through files in visual tree order with ArrowUp (reverse)', async () => {
    setupInvokeMock()

    render(
      <TestProviders>
        <UnifiedDiffModal filePath="tests/Button.test.tsx" isOpen={true} onClose={() => {}} />
      </TestProviders>
    )

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.GetChangedFilesFromMain, { sessionName: 'demo' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('tests/Button.test.tsx')
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowUp' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('src/utils/helpers.ts')
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowUp' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('src/components/Input.tsx')
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowUp' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('src/components/Button.tsx')
    })
  })

  it('does not go past first file in visual order when pressing ArrowUp at start', async () => {
    setupInvokeMock()

    render(
      <TestProviders>
        <UnifiedDiffModal filePath="src/components/Button.tsx" isOpen={true} onClose={() => {}} />
      </TestProviders>
    )

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('src/components/Button.tsx')
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowUp' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('src/components/Button.tsx')
    })
  })

  it('does not go past last file in visual order when pressing ArrowDown at end', async () => {
    setupInvokeMock()

    render(
      <TestProviders>
        <UnifiedDiffModal filePath="tests/Button.test.tsx" isOpen={true} onClose={() => {}} />
      </TestProviders>
    )

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('tests/Button.test.tsx')
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowDown' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('tests/Button.test.tsx')
    })
  })

  it('starts at the first file in visual order when no initial file is selected and navigates in order', async () => {
    setupInvokeMock()

    render(
      <TestProviders>
        <UnifiedDiffModal filePath={null} isOpen={true} onClose={() => {}} />
      </TestProviders>
    )

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.GetChangedFilesFromMain, { sessionName: 'demo' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('src/components/Button.tsx')
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowDown' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('src/components/Input.tsx')
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowDown' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('src/utils/helpers.ts')
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowDown' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('tests/Button.test.tsx')
    })

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowDown' })
    })

    await waitFor(() => {
      const modal = screen.getByTestId('diff-modal')
      expect(modal.dataset.selectedFile).toBe('tests/Button.test.tsx')
    })
  })
})

