import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UnifiedDiffModal } from './UnifiedDiffModal'
import { TauriCommands } from '../../common/tauriCommands'
import { createChangedFile } from '../../tests/test-utils'
import type { LineSelection } from '../../hooks/useLineSelection'
import type { LineInfo } from '../../types/diff'
import { ToastProvider } from '../../common/toast/ToastProvider'
import { GithubIntegrationProvider } from '../../contexts/GithubIntegrationContext'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args)
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {}))
}))

type CommentPayload = {
  filePath: string
  lineRange: { start: number; end: number }
  side: 'old' | 'new'
  selectedText: string
  comment: string
}

const addComment = vi.fn<(payload: CommentPayload) => void>()
const startReview = vi.fn()
const getCommentsForFile = vi.fn(() => [])

vi.mock('../../contexts/ReviewContext', () => ({
  useReview: () => ({
    currentReview: { sessionName: 'demo', comments: [], createdAt: Date.now() },
    addComment,
    removeComment: vi.fn(),
    updateComment: vi.fn(),
    clearReview: vi.fn(),
    startReview,
    getCommentsForFile
  })
}))

vi.mock('../../contexts/FocusContext', () => ({
  useFocus: () => ({
    setFocusForSession: vi.fn(),
    setCurrentFocus: vi.fn()
  })
}))

vi.mock('../../hooks/useSessions', () => ({
  useSessions: () => ({
    sessions: [],
    reloadSessions: vi.fn()
  })
}))

vi.mock('../../hooks/useSelection', () => ({
  useSelection: () => ({
    selection: { kind: 'session', payload: 'demo', sessionState: 'running' as const },
    terminals: { top: 'session-demo-top', bottomBase: 'session-demo-bottom', workingDirectory: '/tmp' },
    setSelection: vi.fn(),
    clearTerminalTracking: vi.fn(),
    isReady: true,
    isSpec: false,
  })
}))

vi.mock('../../hooks/useHighlightWorker', () => ({
  useHighlightWorker: () => ({
    highlightPlans: new Map(),
    readBlockLine: vi.fn(),
    requestBlockHighlight: vi.fn(),
    highlightCode: vi.fn((options: { code: string }) => options.code),
  })
}))

vi.mock('../../hooks/useDiffHover', () => ({
  useDiffHover: () => ({
    setHoveredLineInfo: vi.fn(),
    clearHoveredLine: vi.fn(),
    useHoverKeyboardShortcuts: () => {},
  })
}))

const selectionState: { current: LineSelection | null } = {
  current: null
}

const lineSelectionMock = {
  get selection() {
    return selectionState.current
  },
  handleLineClick: vi.fn(),
  extendSelection: vi.fn(),
  clearSelection: vi.fn(),
  isLineSelected: vi.fn(),
  isLineInRange: vi.fn()
}

vi.mock('../../hooks/useLineSelection', () => ({
  useLineSelection: () => lineSelectionMock
}))

const changedFiles = [
  createChangedFile({ path: 'src/first.ts', change_type: 'modified', additions: 3, deletions: 0 }),
  createChangedFile({ path: 'src/second.ts', change_type: 'modified', additions: 3, deletions: 0 }),
]

type DiffResponseMock = {
  lines: LineInfo[]
  stats: { additions: number; deletions: number }
  fileInfo: { sizeBytes: number }
  isLargeFile: boolean
}

const diffByPath: Record<string, DiffResponseMock> = {
  'src/first.ts': {
    lines: [
      { type: 'unchanged' as const, oldLineNumber: 1, newLineNumber: 1, content: 'first-head-1' },
      { type: 'added' as const, newLineNumber: 2, content: 'first-head-2' },
      { type: 'added' as const, newLineNumber: 3, content: 'first-head-3' },
    ],
    stats: { additions: 2, deletions: 0 },
    fileInfo: { sizeBytes: 32 },
    isLargeFile: false,
  },
  'src/second.ts': {
    lines: [
      { type: 'unchanged' as const, oldLineNumber: 1, newLineNumber: 1, content: 'second-head-1' },
      { type: 'added' as const, newLineNumber: 2, content: 'second-head-2' },
      { type: 'added' as const, newLineNumber: 3, content: 'second-head-3' },
    ],
    stats: { additions: 2, deletions: 0 },
    fileInfo: { sizeBytes: 32 },
    isLargeFile: false,
  },
}

const fileContents: Record<string, { base: string; head: string }> = {
  'src/first.ts': {
    base: 'first-base-1\nfirst-base-2\nfirst-base-3\n',
    head: 'first-head-1\nfirst-head-2\nfirst-head-3\n',
  },
  'src/second.ts': {
    base: 'second-base-1\nsecond-base-2\nsecond-base-3\n',
    head: 'second-head-1\nsecond-head-2\nsecond-head-3\n',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  selectionState.current = {
    filePath: 'src/second.ts',
    startLine: 2,
    endLine: 3,
    side: 'new'
  }

  invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case TauriCommands.GetChangedFilesFromMain:
        return changedFiles
      case TauriCommands.ComputeUnifiedDiffBackend: {
        const path = args?.filePath as string
        return diffByPath[path]
      }
      case TauriCommands.GetCurrentBranchName:
        return 'feature/demo'
      case TauriCommands.GetBaseBranchName:
        return 'main'
      case TauriCommands.GetCommitComparisonInfo:
        return ['base123', 'head456']
      case TauriCommands.GetDiffViewPreferences:
        return { continuous_scroll: false, compact_diffs: true, sidebar_width: 320 }
      case TauriCommands.GetSessionPreferences:
        return { always_show_large_diffs: false }
      case TauriCommands.ListAvailableOpenApps:
        return []
      case TauriCommands.GetDefaultOpenApp:
        return 'code'
      case TauriCommands.GetFileDiffFromMain: {
        const path = args?.filePath as string
        const entry = fileContents[path]
        return [entry?.base ?? '', entry?.head ?? '']
      }
      default:
        return null
    }
  })
})

describe('UnifiedDiffView comment selection', () => {
  it('uses the selection file when selectedFile is stale after multi-line drag', async () => {
    render(
      <GithubIntegrationProvider>
        <ToastProvider>
          <UnifiedDiffModal
            filePath="src/first.ts"
            isOpen={true}
            onClose={() => {}}
          />
        </ToastProvider>
      </GithubIntegrationProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Git Diff Viewer')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText(/Lines 2-3/)).toBeInTheDocument()
    })

    const textarea = screen.getByPlaceholderText(/Write your comment/i)
    fireEvent.change(textarea, { target: { value: 'Looks good' } })

    fireEvent.click(screen.getByRole('button', { name: /Submit/i }))

    await waitFor(() => {
      expect(addComment).toHaveBeenCalled()
    })

    const [payload] = addComment.mock.calls[0]
    expect(payload.filePath).toBe('src/second.ts')
    expect(payload.selectedText).toBe('second-head-2\nsecond-head-3')
  })

  it('pulls base content when selection targets the old side', async () => {
    selectionState.current = {
      filePath: 'src/second.ts',
      startLine: 1,
      endLine: 2,
      side: 'old'
    }

    render(
      <GithubIntegrationProvider>
        <ToastProvider>
          <UnifiedDiffModal
            filePath="src/first.ts"
            isOpen={true}
            onClose={() => {}}
          />
        </ToastProvider>
      </GithubIntegrationProvider>
    )

    await waitFor(() => {
      expect(screen.getByText(/Lines 1-2/)).toBeInTheDocument()
    })

    const textarea = screen.getByPlaceholderText(/Write your comment/i)
    fireEvent.change(textarea, { target: { value: 'Use the previous version' } })
    fireEvent.click(screen.getByRole('button', { name: /Submit/i }))

    await waitFor(() => {
      expect(addComment).toHaveBeenCalled()
    })

    const [payload] = addComment.mock.calls[0]
    expect(payload.filePath).toBe('src/second.ts')
    expect(payload.selectedText).toBe('second-base-1\nsecond-base-2')
  })
})
