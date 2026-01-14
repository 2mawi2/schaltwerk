import { useCallback, useMemo, useRef, useState, memo, useEffect, type ReactNode, type RefObject, type MutableRefObject } from 'react'
import clsx from 'clsx'
import { VscComment, VscDiscard, VscEdit, VscTrash } from 'react-icons/vsc'
import { FileDiff, type DiffLineAnnotation, type FileDiffMetadata } from '@pierre/diffs/react'
import { getHunkSeparatorSlotName, type GetHoveredLineResult, type ThemesType, type FileDiffOptions, type SelectedLineRange, type HunkData } from '@pierre/diffs'

import { getFileIcon } from '../../utils/fileIcons'
import { AnimatedText } from '../common/AnimatedText'
import type { ReviewCommentThread } from '../../types/review'
import type { DiffResponse } from '../../types/diff'
import { OpenInSplitButton, type OpenApp, type OpenInAppRequest } from '../OpenInSplitButton'
import { ConfirmDiscardDialog } from '../common/ConfirmDiscardDialog'
import { shouldCollapseDiff, type DiffFilterResult } from '../../domains/diff/diffFilters'
import { CollapsedDiffBadge } from './CollapsedDiffBadge'
import { useTranslation } from '../../common/i18n'
import {
  convertDiffResponseToFileDiffMetadata,
  createBinaryFileDiff,
} from '../../adapters/pierreDiffAdapter'
import {
  convertThreadsToAnnotations,
  type PierreAnnotationMetadata,
} from '../../adapters/pierreAnnotationAdapter'
import { getPierreThemes, getPierreUnsafeCSS, getThemeType, type SchaltwerkThemeId } from '../../adapters/pierreThemeAdapter'
import { usePierreKeyboardNav } from '../../hooks/usePierreKeyboardNav'
import type { FileDiffData } from './loadDiffs'
import { listenUiEvent, UiEvent, type FontSizeChangedDetail } from '../../common/uiEvents'

export interface ChangedFile {
  path: string
  change_type: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unknown'
  additions?: number
  deletions?: number
}

export interface PierreDiffViewerProps {
  files: ChangedFile[]
  visualFileOrder: string[]
  selectedFile: string | null
  allFileDiffs: Map<string, FileDiffData>
  fileError: string | null
  branchInfo: {
    currentBranch: string
    baseBranch: string
    baseCommit: string
    headCommit: string
  } | null
  isLargeDiffMode: boolean
  isCompactView: boolean
  alwaysShowLargeDiffs: boolean
  expandedFiles: Set<string>
  onToggleFileExpanded: (filePath: string) => void
  getCommentsForFile: (filePath: string) => ReviewCommentThread[]
  onCopyLine?: (payload: { filePath: string; lineNumber: number; side: 'old' | 'new' }) => void
  onCopyCode?: (payload: { filePath: string; text: string }) => void
  onDiscardFile?: (filePath: string) => void | Promise<void>
  onStartCommentFromContext?: (payload: { filePath: string; lineNumber: number; side: 'old' | 'new' }) => void
  onEditComment?: (commentId: string) => void
  onDeleteComment?: (commentId: string) => void
  onLineSelectionChange?: (selection: { filePath: string; startLine: number; endLine: number; side: 'old' | 'new' } | null) => void
  onOpenFile?: (filePath: string) => Promise<OpenInAppRequest | undefined>
  themeId?: SchaltwerkThemeId
  diffStyle?: 'unified' | 'split'
  visibleFileSet?: Set<string>
  renderedFileSet?: Set<string>
  loadingFiles?: Set<string>
  observerRef?: MutableRefObject<IntersectionObserver | null>
  scrollContainerRef?: RefObject<HTMLDivElement>
  fileRefs?: MutableRefObject<Map<string, HTMLDivElement>>
  className?: string
}

interface LineSelection {
  start: number
  end: number
  side: 'old' | 'new'
  filePath: string
}

interface ConvertedFileDiff {
  fileDiff: FileDiffMetadata | null
  collapsedSections: import('../../adapters/pierreDiffAdapter').CollapsedSection[]
}

function convertFileDiffDataToMetadata(
  filePath: string,
  fileDiffData: FileDiffData,
  expandedSections?: Set<number>
): ConvertedFileDiff {
  if (fileDiffData.isBinary) {
    return { fileDiff: createBinaryFileDiff(filePath), collapsedSections: [] }
  }

  if ('diffResult' in fileDiffData && fileDiffData.diffResult) {
    const response: DiffResponse = {
      lines: fileDiffData.diffResult,
      stats: {
        additions: fileDiffData.file.additions ?? 0,
        deletions: fileDiffData.file.deletions ?? 0,
      },
      fileInfo: fileDiffData.fileInfo,
      isLargeFile: false,
      isBinary: fileDiffData.isBinary,
      unsupportedReason: fileDiffData.unsupportedReason,
    }
    const result = convertDiffResponseToFileDiffMetadata(response, filePath, expandedSections)
    return { fileDiff: result.fileDiff, collapsedSections: result.collapsedSections }
  }

  return { fileDiff: null, collapsedSections: [] }
}

interface MemoizedFileDiffProps {
  pierreDiff: FileDiffMetadata
  commentThreads: ReviewCommentThread[]
  collapsedSections: import('../../adapters/pierreDiffAdapter').CollapsedSection[]
  theme: ThemesType
  themeType: 'light' | 'dark'
  diffStyle: 'unified' | 'split'
  unsafeCSS: string
  filePath: string
  fontSize: number
  lineSelection: LineSelection | null
  onLineSelect: (filePath: string, selection: { start: number; end: number; side: 'old' | 'new' } | null) => void
  onStartCommentFromContext?: (payload: { filePath: string; lineNumber: number; side: 'old' | 'new' }) => void
  onEditComment?: (commentId: string) => void
  onDeleteComment?: (commentId: string) => void
  onExpandSection?: (sectionIndex: number) => void
}

const MemoizedFileDiff = memo(function MemoizedFileDiff({
  pierreDiff,
  commentThreads,
  collapsedSections,
  theme,
  themeType,
  diffStyle,
  unsafeCSS,
  filePath,
  fontSize,
  onLineSelect,
  onStartCommentFromContext,
  onEditComment,
  onDeleteComment,
  onExpandSection,
}: Omit<MemoizedFileDiffProps, 'lineSelection'>) {
  const containerRef = useRef<HTMLDivElement>(null)

  const annotations = useMemo(
    () => convertThreadsToAnnotations(commentThreads),
    [commentThreads]
  )

  const hunkToSectionMap = useMemo(() => {
    const map = new Map<number, number>()
    let sectionIdx = 0
    for (let hunkIdx = 0; hunkIdx < pierreDiff.hunks.length; hunkIdx++) {
      const hunk = pierreDiff.hunks[hunkIdx]
      if (hunk.collapsedBefore > 0) {
        map.set(hunkIdx, sectionIdx)
        sectionIdx++
      }
    }
    return map
  }, [pierreDiff.hunks])

  const createSeparatorElement = useCallback((hunk: HunkData): HTMLElement => {
    const container = document.createElement('div')
    container.className = 'pierre-separator flex items-center justify-center py-2 cursor-pointer hover:bg-slate-800/50 transition-colors'
    container.style.cssText = 'background: var(--color-bg-secondary); border-top: 1px solid var(--color-border-subtle); border-bottom: 1px solid var(--color-border-subtle);'

    const button = document.createElement('button')
    button.className = 'text-xs px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 flex items-center gap-1'
    button.innerHTML = `<span>⋯</span><span>${hunk.lines} unchanged line${hunk.lines === 1 ? '' : 's'}</span>`

    if (onExpandSection) {
      const sectionIndex = hunkToSectionMap.get(hunk.hunkIndex)
      if (sectionIndex !== undefined && sectionIndex < collapsedSections.length) {
        button.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          onExpandSection(collapsedSections[sectionIndex].index)
        })
      }
    }

    container.appendChild(button)
    return container
  }, [onExpandSection, hunkToSectionMap, collapsedSections])

  const options = useMemo<FileDiffOptions<PierreAnnotationMetadata>>(
    () => ({
      theme,
      themeType,
      diffStyle,
      unsafeCSS,
      overflow: 'wrap' as const,
      lineDiffType: 'word' as const,
      diffIndicators: 'none' as const,
      expandUnchanged: false,
      disableBackground: false,
      enableLineSelection: true,
      hunkSeparators: createSeparatorElement,
      onLineSelected: (range: SelectedLineRange | null) => {
        if (range) {
          const side = range.side === 'deletions' ? 'old' : 'new'
          onLineSelect(filePath, { start: range.start, end: range.end, side })
        } else {
          onLineSelect(filePath, null)
        }
      },
    }),
    [theme, themeType, diffStyle, unsafeCSS, filePath, onLineSelect, createSeparatorElement]
  )

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<PierreAnnotationMetadata>): ReactNode => {
      if (!annotation.metadata?.isRangeStart) return null
      const comment = annotation.metadata.comment
      const rangeLength = annotation.metadata.rangeLength
      return (
        <div
          className="my-2 mx-2 rounded-md overflow-hidden"
          style={{
            backgroundColor: 'var(--color-bg-tertiary)',
            border: '1px solid var(--color-border-subtle)',
          }}
        >
          <div
            className="flex items-start gap-2 px-3 py-2"
            style={{
              borderLeft: '3px solid var(--color-accent-blue)',
            }}
          >
            <VscComment
              className="flex-shrink-0 mt-0.5"
              style={{ color: 'var(--color-accent-blue)' }}
            />
            <div className="flex-1 min-w-0">
              <div
                className="text-sm leading-relaxed"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {comment.comment}
              </div>
              {rangeLength > 1 && (
                <div
                  className="text-xs mt-1"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  Lines {comment.lineRange.start}–{comment.lineRange.end}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {onEditComment && (
                <button
                  className="p-1 rounded hover:bg-slate-700/50 transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEditComment(comment.id)
                  }}
                  title="Edit comment"
                >
                  <VscEdit className="w-3.5 h-3.5" />
                </button>
              )}
              {onDeleteComment && (
                <button
                  className="p-1 rounded hover:bg-slate-700/50 transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteComment(comment.id)
                  }}
                  title="Delete comment"
                >
                  <VscTrash className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )
    },
    [onEditComment, onDeleteComment]
  )

  const renderHoverUtility = useCallback(
    (getHoveredLine: () => GetHoveredLineResult<'diff'> | undefined): ReactNode => {
      const hoveredLine = getHoveredLine()
      if (!hoveredLine) return null

      return (
        <button
          className="p-1 rounded bg-elevated hover:bg-hover text-secondary"
          onClick={() => {
            if (onStartCommentFromContext) {
              const side = hoveredLine.side === 'deletions' ? 'old' : 'new'
              onStartCommentFromContext({
                filePath,
                lineNumber: hoveredLine.lineNumber,
                side,
              })
            }
          }}
        >
          <VscComment className="w-4 h-4" />
        </button>
      )
    },
    [filePath, onStartCommentFromContext]
  )

  const separatorElements = useRef<HTMLDivElement[]>([])

  const renderSeparatorsImperative = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const diffsElement = container.querySelector('diffs-container')
    if (!diffsElement) return

    separatorElements.current.forEach(el => el.remove())
    separatorElements.current = []

    const separatorTypes = diffStyle === 'split' ? ['additions', 'deletions'] as const : ['unified'] as const

    pierreDiff.hunks.forEach((hunk, hunkIndex) => {
      if (hunk.collapsedBefore > 0) {
        const sectionIndex = hunkToSectionMap.get(hunkIndex)

        separatorTypes.forEach((type) => {
          const slotName = getHunkSeparatorSlotName(type, hunkIndex)
          const wrapper = document.createElement('div')
          wrapper.setAttribute('slot', slotName)
          wrapper.style.display = 'contents'

          const separator = document.createElement('div')
          separator.className = 'pierre-separator'
          separator.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 4px 0;
            background: transparent;
            position: relative;
          `

          const button = document.createElement('button')
          button.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px;
            font-size: ${fontSize}px;
            font-family: var(--font-family-mono);
            color: var(--color-text-secondary);
            background: var(--color-bg-elevated);
            border: 1px solid var(--color-border-subtle);
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.15s ease;
          `
          button.onmouseenter = () => {
            button.style.background = 'var(--color-bg-hover)'
            button.style.color = 'var(--color-text-primary)'
            button.style.borderColor = 'var(--color-border-default)'
          }
          button.onmouseleave = () => {
            button.style.background = 'var(--color-bg-elevated)'
            button.style.color = 'var(--color-text-secondary)'
            button.style.borderColor = 'var(--color-border-subtle)'
          }

          const expandIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          expandIcon.setAttribute('width', '12')
          expandIcon.setAttribute('height', '12')
          expandIcon.setAttribute('viewBox', '0 0 16 16')
          expandIcon.setAttribute('fill', 'currentColor')
          expandIcon.innerHTML = '<path d="M8.177.677l4.146 4.147a.5.5 0 0 1-.708.708L8.5 2.417V7.5a.5.5 0 0 1-1 0V2.417L4.385 5.532a.5.5 0 1 1-.708-.708L7.823.677a.5.5 0 0 1 .354-.147.5.5 0 0 1 0 0a.5.5 0 0 1 .354.147zm-.354 14.646l-4.146-4.147a.5.5 0 0 1 .708-.708L7.5 13.583V8.5a.5.5 0 0 1 1 0v5.083l3.115-3.115a.5.5 0 0 1 .708.708l-4.147 4.147a.5.5 0 0 1-.354.147.5.5 0 0 1-.354-.147z"/>'

          const text = document.createElement('span')
          text.textContent = `${hunk.collapsedBefore} unchanged line${hunk.collapsedBefore === 1 ? '' : 's'}`

          button.appendChild(expandIcon)
          button.appendChild(text)

          if (onExpandSection && sectionIndex !== undefined && sectionIndex < collapsedSections.length) {
            button.addEventListener('click', (e) => {
              e.preventDefault()
              e.stopPropagation()
              onExpandSection(collapsedSections[sectionIndex].index)
            })
          }

          separator.appendChild(button)
          wrapper.appendChild(separator)
          diffsElement.appendChild(wrapper)
          separatorElements.current.push(wrapper)
        })
      }
    })
  }, [pierreDiff.hunks, diffStyle, hunkToSectionMap, onExpandSection, collapsedSections, fontSize])

  useEffect(() => {
    const frameId = requestAnimationFrame(renderSeparatorsImperative)
    return () => {
      cancelAnimationFrame(frameId)
      separatorElements.current.forEach(el => el.remove())
      separatorElements.current = []
    }
  }, [renderSeparatorsImperative])

  const fontStyles = useMemo(() => ({
    '--diffs-font-size': `${fontSize}px`,
    '--diffs-line-height': `${Math.round(fontSize * 1.5)}px`,
  } as React.CSSProperties), [fontSize])

  return (
    <div ref={containerRef}>
      <FileDiff<PierreAnnotationMetadata>
        fileDiff={pierreDiff}
        options={options}
        style={fontStyles}
        lineAnnotations={annotations}
        renderAnnotation={renderAnnotation}
        renderHoverUtility={renderHoverUtility}
      />
    </div>
  )
})

export function PierreDiffViewer({
  files,
  visualFileOrder,
  selectedFile,
  allFileDiffs,
  fileError,
  branchInfo,
  isLargeDiffMode,
  isCompactView,
  alwaysShowLargeDiffs,
  expandedFiles,
  onToggleFileExpanded,
  getCommentsForFile,
  onCopyLine,
  onCopyCode,
  onDiscardFile,
  onStartCommentFromContext,
  onEditComment,
  onDeleteComment,
  onLineSelectionChange,
  onOpenFile,
  themeId = 'dark',
  diffStyle = 'unified',
  visibleFileSet: _visibleFileSet,
  renderedFileSet,
  loadingFiles,
  observerRef,
  scrollContainerRef: externalScrollRef,
  fileRefs: externalFileRefs,
  className,
}: PierreDiffViewerProps) {
  const { t } = useTranslation()
  const internalContainerRef = useRef<HTMLDivElement>(null)
  const containerRef = externalScrollRef ?? internalContainerRef
  const editorFilter = useCallback((app: OpenApp) => app.kind === 'editor', [])
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discardBusy, setDiscardBusy] = useState(false)
  const [pendingDiscardFile, setPendingDiscardFile] = useState<string | null>(null)
  const [expandedSectionsMap, setExpandedSectionsMap] = useState<Map<string, Set<number>>>(new Map())
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    lineNumber: number
    side: 'old' | 'new'
    filePath: string
    content?: string
  } | null>(null)

  const [terminalFontSize, setTerminalFontSize] = useState(() => {
    const cssValue = getComputedStyle(document.documentElement).getPropertyValue('--terminal-font-size')
    return parseInt(cssValue, 10) || 13
  })

  useEffect(() => {
    const unlisten = listenUiEvent(UiEvent.FontSizeChanged, (detail: FontSizeChangedDetail) => {
      setTerminalFontSize(detail.terminalFontSize)
    })
    return unlisten
  }, [])

  const theme = useMemo(() => getPierreThemes(themeId), [themeId])
  const themeType = useMemo(() => getThemeType(themeId), [themeId])
  const unsafeCSS = useMemo(() => getPierreUnsafeCSS(themeId), [themeId])

  const sortedFiles = useMemo(() => {
    const fileMap = new Map(files.map((f) => [f.path, f]))
    return visualFileOrder
      .map((path) => fileMap.get(path))
      .filter((f): f is ChangedFile => f !== undefined)
  }, [files, visualFileOrder])

  const filesToRender = useMemo(() => {
    if (isLargeDiffMode) {
      return sortedFiles.filter((f) => f.path === selectedFile)
    }
    return sortedFiles
  }, [isLargeDiffMode, sortedFiles, selectedFile])

  const pierreDiffsMap = useMemo(() => {
    const map = new Map<string, ConvertedFileDiff>()
    for (const file of filesToRender) {
      const fileDiff = allFileDiffs.get(file.path)
      if (fileDiff) {
        const expandedSections = expandedSectionsMap.get(file.path)
        map.set(file.path, convertFileDiffDataToMetadata(file.path, fileDiff, expandedSections))
      } else {
        map.set(file.path, { fileDiff: null, collapsedSections: [] })
      }
    }
    return map
  }, [filesToRender, allFileDiffs, expandedSectionsMap])

  const filterResultsMap = useMemo(() => {
    const map = new Map<string, DiffFilterResult>()
    for (const file of filesToRender) {
      const fileDiff = allFileDiffs.get(file.path)
      if (fileDiff) {
        map.set(file.path, shouldCollapseDiff(
          file.path,
          fileDiff.totalLineCount ?? 0,
          fileDiff.fileInfo.sizeBytes,
          {
            alwaysShowLargeDiffs,
            isCompactView,
            changedLinesCount: fileDiff.changedLinesCount,
          }
        ))
      } else {
        map.set(file.path, { shouldCollapse: false, isGenerated: false, isLarge: false, reason: undefined })
      }
    }
    return map
  }, [filesToRender, allFileDiffs, alwaysShowLargeDiffs, isCompactView])

  const totalLines = useMemo(() => {
    if (!selectedFile) return 0
    const diff = allFileDiffs.get(selectedFile)
    if (!diff) return 0
    if (diff.totalLineCount) return diff.totalLineCount
    if ('diffResult' in diff && diff.diffResult) return diff.diffResult.length
    return 0
  }, [selectedFile, allFileDiffs])

  const { focusedLine: _focusedLine, isKeyboardActive: _isKeyboardActive } = usePierreKeyboardNav({
    containerRef,
    totalLines,
    enabled: true,
    onEnter: (lineNumber, side) => {
      if (selectedFile && onStartCommentFromContext) {
        onStartCommentFromContext({ filePath: selectedFile, lineNumber, side })
      }
    },
  })

  const handleContextMenu = useCallback(
    (filePath: string, event: { x: number; y: number; lineNumber: number; side: 'old' | 'new'; selectedText: string }) => {
      setContextMenu({
        x: event.x,
        y: event.y,
        lineNumber: event.lineNumber,
        side: event.side,
        filePath,
        content: event.selectedText || undefined,
      })
    },
    []
  )

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const handleLineSelect = useCallback((filePath: string, selection: { start: number; end: number; side: 'old' | 'new' } | null) => {
    if (selection) {
      onLineSelectionChange?.({
        filePath,
        startLine: selection.start,
        endLine: selection.end,
        side: selection.side,
      })
    } else {
      onLineSelectionChange?.(null)
    }
  }, [onLineSelectionChange])

  const handleExpandSection = useCallback((filePath: string, sectionIndex: number) => {
    setExpandedSectionsMap((prev) => {
      const newMap = new Map(prev)
      const existingSet = newMap.get(filePath) ?? new Set()
      const newSet = new Set(existingSet)
      if (newSet.has(sectionIndex)) {
        newSet.delete(sectionIndex)
      } else {
        newSet.add(sectionIndex)
      }
      newMap.set(filePath, newSet)
      return newMap
    })
  }, [])

  if (!selectedFile && files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <AnimatedText text={t.diffViewer.loading} />
      </div>
    )
  }

  if (fileError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-8">
          <div className="text-6xl mb-4 text-slate-600">&#x26A0;&#xFE0F;</div>
          <div className="text-lg font-medium text-slate-400 mb-2">{t.diffViewer.cannotDisplayDiff}</div>
          <div className="text-sm text-slate-500">{fileError}</div>
        </div>
      </div>
    )
  }

  return (
    <>
      {branchInfo && (
        <div className="px-4 py-2 text-xs text-slate-400 border-b border-slate-700 bg-slate-950">
          {branchInfo.baseBranch} ({branchInfo.baseCommit.slice(0, 7)}) &rarr; {branchInfo.currentBranch} ({branchInfo.headCommit.slice(0, 7)})
        </div>
      )}

      <div
        ref={externalScrollRef ? undefined : internalContainerRef}
        className={clsx("flex-1 overflow-auto min-h-0 w-full font-mono text-sm bg-slate-900/30", className)}
        data-testid="diff-scroll-container"
        style={{ contain: 'strict' }}
      >
        {filesToRender.map((file) => {
          const fileDiff = allFileDiffs.get(file.path)
          const commentThreads = getCommentsForFile(file.path)
          const commentCount = commentThreads.reduce((sum, thread) => sum + thread.comments.length, 0)
          const isCurrentFile = file.path === selectedFile

          const convertedDiff = pierreDiffsMap.get(file.path) ?? { fileDiff: null, collapsedSections: [] }
          const pierreDiff = convertedDiff.fileDiff
          const collapsedSections = convertedDiff.collapsedSections
          const filterResult = filterResultsMap.get(file.path) ?? { shouldCollapse: false, isGenerated: false, isLarge: false, reason: undefined }

          const isFileExpanded = expandedFiles.has(file.path)
          const isDeletedFile = file.change_type === 'deleted'
          const shouldCollapse = (isDeletedFile && !isFileExpanded) || (filterResult.shouldCollapse && !isFileExpanded)

          const isRendered = renderedFileSet ? renderedFileSet.has(file.path) : true
          const isLoading = loadingFiles ? loadingFiles.has(file.path) : false

          const setFileRef = (node: HTMLDivElement | null) => {
            if (externalFileRefs) {
              if (node) {
                externalFileRefs.current.set(file.path, node)
                observerRef?.current?.observe(node)
              } else {
                externalFileRefs.current.delete(file.path)
              }
            }
          }

          return (
            <div
              key={file.path}
              ref={setFileRef}
              data-file-path={file.path}
              className="border-b border-slate-800 last:border-b-0"
              style={{
                contentVisibility: 'auto',
                contain: 'layout style paint',
                containIntrinsicSize: 'auto 300px',
              }}
            >
              {/* File header */}
              <div
                className={clsx(
                  'sticky top-0 z-10 bg-slate-950 border-b border-slate-700 px-4 py-3 flex items-center justify-between gap-4',
                  isCurrentFile && 'bg-slate-900'
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {getFileIcon(file.change_type, file.path)}
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-slate-100 truncate">{file.path}</div>
                    <div className="text-xs text-slate-400">
                      {file.change_type === 'added' && t.diffViewer.newFile}
                      {file.change_type === 'deleted' && t.diffViewer.deletedFile}
                      {file.change_type === 'modified' && t.diffViewer.modified}
                      {file.change_type === 'renamed' && t.diffViewer.renamed}
                      {file.change_type === 'copied' && t.diffViewer.copied}
                      {file.change_type === 'unknown' && t.diffViewer.changed}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {commentCount > 0 && (
                    <div
                      className="flex items-center gap-1 text-xs font-medium"
                      style={{ color: 'var(--color-accent-blue-light)' }}
                    >
                      <VscComment />
                      <span>
                        {commentCount} {commentCount > 1 ? t.diffViewer.comments : t.diffViewer.comment}
                      </span>
                    </div>
                  )}
                  {onDiscardFile && (
                    <button
                      title={t.diffViewer.discardChangesForFile}
                      aria-label={`Discard ${file.path}`}
                      className="p-1 rounded hover:bg-slate-800 text-slate-300"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPendingDiscardFile(file.path)
                        setDiscardOpen(true)
                      }}
                    >
                      <VscDiscard className="text-base" />
                    </button>
                  )}
                  {onOpenFile && (
                    <OpenInSplitButton resolvePath={() => onOpenFile(file.path)} filter={editorFilter} />
                  )}
                </div>
              </div>

              {/* File diff content */}
              {!isRendered ? (
                <div className="px-4 py-8 text-center text-slate-500" style={{ minHeight: 200 }}>
                  <div className="h-20" />
                </div>
              ) : isLoading || !fileDiff ? (
                <div className="px-4 py-8 text-center text-slate-500" style={{ minHeight: 200 }}>
                  <AnimatedText text="loading" size="sm" />
                </div>
              ) : shouldCollapse ? (
                <CollapsedDiffBadge
                  filterResult={
                    isDeletedFile
                      ? { ...filterResult, shouldCollapse: true, reason: 'deleted' }
                      : filterResult
                  }
                  onClick={() => onToggleFileExpanded(file.path)}
                />
              ) : fileDiff.isBinary ? (
                <div className="px-4 py-10 text-center text-slate-400">
                  <div className="text-lg font-medium text-slate-200">{t.diffViewer.binaryFile}</div>
                  <div className="text-sm text-slate-400">
                    {fileDiff.unsupportedReason || t.diffViewer.fileCannotDisplay}
                  </div>
                </div>
              ) : pierreDiff ? (
                <div
                  className="pierre-diff-container"
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    const target = e.target as HTMLElement
                    const lineElement = target.closest('[data-line-number]')
                    if (lineElement) {
                      const lineNumber = parseInt(lineElement.getAttribute('data-line-number') ?? '0', 10)
                      const sideElement = target.closest('[data-side]')
                      const side: 'old' | 'new' = sideElement?.getAttribute('data-side') === 'old' ? 'old' : 'new'
                      handleContextMenu(file.path, {
                        x: e.clientX,
                        y: e.clientY,
                        lineNumber,
                        side,
                        selectedText: window.getSelection()?.toString() ?? '',
                      })
                    }
                  }}
                >
                  <MemoizedFileDiff
                    pierreDiff={pierreDiff}
                    commentThreads={commentThreads}
                    collapsedSections={collapsedSections}
                    theme={theme}
                    themeType={themeType}
                    diffStyle={diffStyle}
                    unsafeCSS={unsafeCSS}
                    filePath={file.path}
                    fontSize={terminalFontSize}
                    onLineSelect={handleLineSelect}
                    onStartCommentFromContext={onStartCommentFromContext}
                    onEditComment={onEditComment}
                    onDeleteComment={onDeleteComment}
                    onExpandSection={(sectionIndex) => handleExpandSection(file.path, sectionIndex)}
                  />
                </div>
              ) : (
                <div className="px-4 py-8 text-center text-slate-500">
                  {t.diffViewer.cannotDisplayDiff}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          role="menu"
          className="fixed z-50 min-w-[220px] rounded-lg overflow-hidden shadow-xl"
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border-subtle)',
          }}
          onClick={(e) => {
            e.stopPropagation()
            closeContextMenu()
          }}
        >
          {onCopyLine && (
            <button
              role="menuitem"
              className="w-full text-left px-4 py-2 text-sm hover:bg-slate-700"
              style={{ color: 'var(--color-text-secondary)' }}
              onClick={() => {
                onCopyLine({
                  filePath: contextMenu.filePath,
                  lineNumber: contextMenu.lineNumber,
                  side: contextMenu.side,
                })
                closeContextMenu()
              }}
            >
              {t.diffViewer.copyLine.replace('{line}', String(contextMenu.lineNumber))}
            </button>
          )}
          {contextMenu.content && onCopyCode && (
            <button
              role="menuitem"
              className="w-full text-left px-4 py-2 text-sm hover:bg-slate-700"
              style={{ color: 'var(--color-text-secondary)' }}
              onClick={() => {
                onCopyCode({ filePath: contextMenu.filePath, text: contextMenu.content! })
                closeContextMenu()
              }}
            >
              {t.diffViewer.copyLineContents}
            </button>
          )}
          {onStartCommentFromContext && (
            <button
              role="menuitem"
              className="w-full text-left px-4 py-2 text-sm hover:bg-slate-700"
              style={{ color: 'var(--color-text-secondary)' }}
              onClick={() => {
                onStartCommentFromContext({
                  filePath: contextMenu.filePath,
                  lineNumber: contextMenu.lineNumber,
                  side: contextMenu.side,
                })
                closeContextMenu()
              }}
            >
              {t.diffViewer.startCommentThread}
            </button>
          )}
        </div>
      )}

      <ConfirmDiscardDialog
        open={discardOpen}
        filePath={pendingDiscardFile}
        isBusy={discardBusy}
        onCancel={() => {
          setDiscardOpen(false)
          setPendingDiscardFile(null)
        }}
        onConfirm={() => {
          void (async () => {
            if (!pendingDiscardFile || !onDiscardFile) return
            try {
              setDiscardBusy(true)
              await onDiscardFile(pendingDiscardFile)
            } finally {
              setDiscardBusy(false)
              setDiscardOpen(false)
              setPendingDiscardFile(null)
            }
          })()
        }}
      />
    </>
  )
}
