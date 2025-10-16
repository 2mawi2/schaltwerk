import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor, fireEvent } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { TestProviders } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import type { LineSelection } from '../../hooks/useLineSelection'
import type { FileDiffData } from './loadDiffs'

const selectionState: { current: LineSelection | null } = { current: null }

const handleLineClick = vi.fn((lineNum: number, side: 'old' | 'new', filePath: string) => {
  selectionState.current = { startLine: lineNum, endLine: lineNum, side, filePath }
})

const extendSelection = vi.fn((lineNum: number, side: 'old' | 'new', filePath: string) => {
  const current = selectionState.current
  if (!current || current.filePath !== filePath || current.side !== side) {
    selectionState.current = { startLine: lineNum, endLine: lineNum, side, filePath }
    return
  }
  selectionState.current = {
    startLine: Math.min(current.startLine, lineNum),
    endLine: Math.max(current.endLine, lineNum),
    side,
    filePath
  }
})

const clearSelection = vi.fn(() => {
  selectionState.current = null
})

const isLineSelected = vi.fn(() => false)
const isLineInRange = vi.fn(() => false)

const lineSelectionMock = {
  get selection() {
    return selectionState.current
  },
  handleLineClick: (...args: Parameters<typeof handleLineClick>) => handleLineClick(...args),
  extendSelection: (...args: Parameters<typeof extendSelection>) => extendSelection(...args),
  clearSelection: () => clearSelection(),
  isLineSelected: (...args: Parameters<typeof isLineSelected>) => isLineSelected(...args),
  isLineInRange: (...args: Parameters<typeof isLineInRange>) => isLineInRange(...args)
}

vi.mock('../../hooks/useLineSelection', () => ({
  useLineSelection: () => lineSelectionMock
}))

vi.mock('../../contexts/SelectionContext', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../contexts/SelectionContext')
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

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args)
}))

const sampleDiff: FileDiffData = {
  file: { path: 'src/App.tsx', change_type: 'modified' },
  diffResult: [
    { type: 'unchanged', oldLineNumber: 1, newLineNumber: 1, content: 'const a = 1' },
    { type: 'added', newLineNumber: 2, content: 'const b = 2' },
  ],
  changedLinesCount: 1,
  fileInfo: { sizeBytes: 12, language: 'typescript' }
}

const loadFileDiffMock = vi.fn(async () => sampleDiff)

vi.mock('./loadDiffs', async () => {
  const actual = await vi.importActual<typeof import('./loadDiffs')>('./loadDiffs')
  return {
    ...actual,
    loadFileDiff: (...args: Parameters<typeof loadFileDiffMock>) => loadFileDiffMock(...args),
    loadCommitFileDiff: vi.fn()
  }
})

async function renderModal() {
  invokeMock.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case TauriCommands.GetChangedFilesFromMain:
        return [{ path: sampleDiff.file.path, change_type: sampleDiff.file.change_type }]
      case TauriCommands.GetCurrentBranchName:
        return 'feature/demo'
      case TauriCommands.GetBaseBranchName:
        return 'main'
      case TauriCommands.GetCommitComparisonInfo:
        return ['abc123', 'def456']
      case TauriCommands.GetDiffViewPreferences:
        return { continuous_scroll: false, compact_diffs: true, sidebar_width: 320 }
      case TauriCommands.GetSessionPreferences:
        return { auto_commit_on_review: false, skip_confirmation_modals: false }
      case TauriCommands.ListAvailableOpenApps:
        return []
      case TauriCommands.GetDefaultOpenApp:
        return 'code'
      case TauriCommands.GetProjectSettings:
        return { project_name: 'demo', project_path: '/tmp/demo' }
      default:
        return null
    }
  })

  const utils = render(
    <TestProviders>
      <UnifiedDiffModal filePath={sampleDiff.file.path} isOpen={true} onClose={() => {}} />
    </TestProviders>
  )

  await waitFor(() => {
    expect(loadFileDiffMock).toHaveBeenCalled()
  })

  return utils
}

beforeEach(() => {
  selectionState.current = null
  handleLineClick.mockClear()
  extendSelection.mockClear()
  clearSelection.mockClear()
  isLineSelected.mockClear()
  isLineInRange.mockClear()
  loadFileDiffMock.mockClear()
  invokeMock.mockClear()
  document.body.classList.remove('sw-no-text-select')
})

afterEach(() => {
  document.body.classList.remove('sw-no-text-select')
})

describe('UnifiedDiffModal line selection behaviour', () => {
  it('calls selection handlers with file path when dragging across rows', async () => {
    const { container } = await renderModal()

    const firstRow = await waitFor(() => container.querySelector('tr[data-line-num="1"]') as HTMLTableRowElement)
    const secondRow = await waitFor(() => container.querySelector('tr[data-line-num="2"]') as HTMLTableRowElement)

    fireEvent.mouseDown(firstRow, { button: 0 })

    await waitFor(() => {
      expect(handleLineClick).toHaveBeenCalledWith(
        1,
        'new',
        sampleDiff.file.path,
        expect.objectContaining({ type: 'mousedown' })
      )
    })

    await waitFor(() => {
      expect(document.body.classList.contains('sw-no-text-select')).toBe(true)
    })

    fireEvent.mouseEnter(secondRow)

    await waitFor(() => {
      expect(extendSelection).toHaveBeenCalledWith(2, 'new', sampleDiff.file.path)
    })

    fireEvent.mouseUp(secondRow)

    await waitFor(() => {
      expect(document.body.classList.contains('sw-no-text-select')).toBe(false)
    })
  })

  it('clears dragging state when mouseup happens outside the diff row', async () => {
    const { container } = await renderModal()

    const firstRow = await waitFor(() => container.querySelector('tr[data-line-num="1"]') as HTMLTableRowElement)

    fireEvent.mouseDown(firstRow, { button: 0 })

    await waitFor(() => {
      expect(handleLineClick).toHaveBeenCalled()
    })

    fireEvent.mouseUp(document)

    await waitFor(() => {
      expect(document.body.classList.contains('sw-no-text-select')).toBe(false)
    })
  })
})
