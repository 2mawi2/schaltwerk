import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PierreDiffViewer, type ChangedFile, type PierreDiffViewerProps } from './PierreDiffViewer'
import type { ReviewCommentThread } from '../../types/review'
import type { FileDiffData } from './loadDiffs'
import type { DiffLineAnnotation } from '@pierre/diffs/react'
import type { PierreAnnotationMetadata } from '../../adapters/pierreAnnotationAdapter'

type CapturedFileDiffProps = {
  lineAnnotations?: DiffLineAnnotation<PierreAnnotationMetadata>[]
  renderAnnotation?: (annotation: DiffLineAnnotation<PierreAnnotationMetadata>) => React.ReactNode
}

let capturedProps: CapturedFileDiffProps = {}

vi.mock('@pierre/diffs/react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@pierre/diffs/react')
  return {
    ...actual,
    FileDiff: vi.fn((props: CapturedFileDiffProps) => {
      capturedProps = props
      const { lineAnnotations, renderAnnotation } = props
      const content = lineAnnotations?.map((annotation, idx: number) => {
        const rendered = renderAnnotation?.(annotation)
        return (
          <div key={idx} data-testid={`annotation-${annotation.side}-${annotation.lineNumber}`}>
            {annotation.metadata?.isRangeStart && (
              <span data-testid="annotation-content">{rendered}</span>
            )}
          </div>
        )
      })
      return <div data-testid="pierre-file-diff">{content}</div>
    }),
  }
})

const mockFile: ChangedFile = {
  path: 'src/test.ts',
  change_type: 'modified',
  additions: 5,
  deletions: 2,
}

const mockFileDiff: FileDiffData = {
  file: {
    path: 'src/test.ts',
    change_type: 'modified',
    additions: 5,
    deletions: 2,
    changes: 7,
  },
  diffResult: [
    { type: 'unchanged', oldLineNumber: 1, newLineNumber: 1, content: 'const a = 1' },
    { type: 'added', newLineNumber: 2, content: 'const b = 2' },
    { type: 'unchanged', oldLineNumber: 2, newLineNumber: 3, content: 'const c = 3' },
  ],
  changedLinesCount: 1,
  fileInfo: { sizeBytes: 100, language: 'typescript' },
  totalLineCount: 3,
}

const defaultProps: PierreDiffViewerProps = {
  files: [mockFile],
  visualFileOrder: ['src/test.ts'],
  selectedFile: 'src/test.ts',
  allFileDiffs: new Map([['src/test.ts', mockFileDiff]]),
  fileError: null,
  branchInfo: null,
  isLargeDiffMode: false,
  isCompactView: false,
  alwaysShowLargeDiffs: false,
  expandedFiles: new Set(),
  onToggleFileExpanded: vi.fn(),
  getCommentsForFile: vi.fn(() => []),
  themeId: 'dark',
  diffStyle: 'unified',
}

describe('PierreDiffViewer annotation display', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedProps = {}
  })

  it('renders annotations when comments exist', () => {
    const thread: ReviewCommentThread = {
      id: 'thread-1',
      filePath: 'src/test.ts',
      side: 'new',
      lineRange: { start: 2, end: 2 },
      comments: [{
        id: 'comment-1',
        filePath: 'src/test.ts',
        lineRange: { start: 2, end: 2 },
        side: 'new',
        selectedText: 'const b = 2',
        comment: 'This looks good!',
        timestamp: Date.now(),
      }],
    }

    const getCommentsForFile = vi.fn((path: string) => {
      if (path === 'src/test.ts') return [thread]
      return []
    })

    render(
      <PierreDiffViewer
        {...defaultProps}
        getCommentsForFile={getCommentsForFile}
      />
    )

    expect(getCommentsForFile).toHaveBeenCalledWith('src/test.ts')
    expect(screen.getByTestId('pierre-file-diff')).toBeInTheDocument()
    expect(screen.getByTestId('annotation-additions-2')).toBeInTheDocument()
    expect(screen.getByTestId('annotation-content')).toBeInTheDocument()
  })

  it('converts old side to deletions', () => {
    const thread: ReviewCommentThread = {
      id: 'thread-2',
      filePath: 'src/test.ts',
      side: 'old',
      lineRange: { start: 1, end: 1 },
      comments: [{
        id: 'comment-2',
        filePath: 'src/test.ts',
        lineRange: { start: 1, end: 1 },
        side: 'old',
        selectedText: 'const a = 1',
        comment: 'Old line comment',
        timestamp: Date.now(),
      }],
    }

    render(
      <PierreDiffViewer
        {...defaultProps}
        getCommentsForFile={() => [thread]}
      />
    )

    expect(screen.getByTestId('annotation-deletions-1')).toBeInTheDocument()
  })

  it('renders no annotations when no comments', () => {
    render(<PierreDiffViewer {...defaultProps} />)

    expect(screen.getByTestId('pierre-file-diff')).toBeInTheDocument()
    expect(screen.queryByTestId('annotation-content')).not.toBeInTheDocument()
  })

  it('renders multiple annotations for multi-line comments', () => {
    const thread: ReviewCommentThread = {
      id: 'thread-3',
      filePath: 'src/test.ts',
      side: 'new',
      lineRange: { start: 1, end: 3 },
      comments: [{
        id: 'comment-3',
        filePath: 'src/test.ts',
        lineRange: { start: 1, end: 3 },
        side: 'new',
        selectedText: 'lines 1-3',
        comment: 'Multi-line comment',
        timestamp: Date.now(),
      }],
    }

    render(
      <PierreDiffViewer
        {...defaultProps}
        getCommentsForFile={() => [thread]}
      />
    )

    expect(screen.getByTestId('annotation-additions-1')).toBeInTheDocument()
    expect(screen.getByTestId('annotation-additions-2')).toBeInTheDocument()
    expect(screen.getByTestId('annotation-additions-3')).toBeInTheDocument()
    expect(screen.getAllByTestId('annotation-content')).toHaveLength(1)
  })

  it('passes correct annotation structure to FileDiff', () => {
    const thread: ReviewCommentThread = {
      id: 'thread-verify',
      filePath: 'src/test.ts',
      side: 'new',
      lineRange: { start: 2, end: 2 },
      comments: [{
        id: 'comment-verify',
        filePath: 'src/test.ts',
        lineRange: { start: 2, end: 2 },
        side: 'new',
        selectedText: 'const b = 2',
        comment: 'Verification comment',
        timestamp: Date.now(),
      }],
    }

    render(
      <PierreDiffViewer
        {...defaultProps}
        getCommentsForFile={() => [thread]}
      />
    )

    expect(capturedProps.lineAnnotations).toBeDefined()
    expect(capturedProps.lineAnnotations).toHaveLength(1)

    const annotation = capturedProps.lineAnnotations![0]
    expect(annotation.side).toBe('additions')
    expect(annotation.lineNumber).toBe(2)
    expect(annotation.metadata).toBeDefined()
    expect(annotation.metadata!.isRangeStart).toBe(true)
    expect(annotation.metadata!.comment.comment).toBe('Verification comment')
    expect(annotation.metadata!.threadId).toBe('thread-verify')
  })

  it('passes correct renderAnnotation callback that returns content', () => {
    const thread: ReviewCommentThread = {
      id: 'thread-render',
      filePath: 'src/test.ts',
      side: 'new',
      lineRange: { start: 1, end: 1 },
      comments: [{
        id: 'comment-render',
        filePath: 'src/test.ts',
        lineRange: { start: 1, end: 1 },
        side: 'new',
        selectedText: 'text',
        comment: 'Should render this',
        timestamp: Date.now(),
      }],
    }

    render(
      <PierreDiffViewer
        {...defaultProps}
        getCommentsForFile={() => [thread]}
      />
    )

    expect(capturedProps.renderAnnotation).toBeDefined()

    const annotation = capturedProps.lineAnnotations![0]
    const rendered = capturedProps.renderAnnotation!(annotation)

    expect(rendered).not.toBeNull()
  })
})
