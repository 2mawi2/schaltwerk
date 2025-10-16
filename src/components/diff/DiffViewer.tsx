import React, { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { VscComment } from 'react-icons/vsc'
import { getFileIcon } from '../../utils/fileIcons'
import { DiffLineRow } from './DiffLineRow'
import { ChangedFile } from './DiffFileExplorer'
import { FileDiffData } from './loadDiffs'
import { AnimatedText } from '../common/AnimatedText'
import { ReviewCommentThread } from '../../types/review'
import { LineSelection } from '../../hooks/useLineSelection'
import { theme } from '../../common/theme'

type ContextMenuState =
  | {
      kind: 'line'
      filePath: string
      lineNumber: number
      side: 'old' | 'new'
      content?: string
      position: { x: number; y: number }
    }
  | {
      kind: 'file'
      filePath: string
      position: { x: number; y: number }
    }

type LineContextMenuState = Extract<ContextMenuState, { kind: 'line' }>
type FileContextMenuState = Extract<ContextMenuState, { kind: 'file' }>
type ContextMenuInput = Omit<LineContextMenuState, 'position'> | Omit<FileContextMenuState, 'position'>

interface HorizontalScrollRegionProps {
  children: React.ReactNode
  bodyRef?: (node: HTMLDivElement | null) => void
  onActivate: (element: HTMLDivElement | null) => void
}

function HorizontalScrollRegion({ children, bodyRef, onActivate }: HorizontalScrollRegionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [showLeft, setShowLeft] = useState(false)
  const [showRight, setShowRight] = useState(false)
  const rafRef = useRef<number | null>(null)

  const updateIndicators = useCallback(() => {
    const node = containerRef.current
    if (!node) return
    const { scrollLeft, scrollWidth, clientWidth } = node
    setShowLeft(scrollLeft > 0)
    setShowRight(scrollLeft + clientWidth < scrollWidth - 1)
  }, [])

  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
    if (node) {
      bodyRef?.(node)
      updateIndicators()
    } else {
      bodyRef?.(null)
    }
  }, [bodyRef, updateIndicators])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return

    const handleScroll = () => {
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        updateIndicators()
      })
    }

    node.addEventListener('scroll', handleScroll, { passive: true })
    updateIndicators()

    return () => {
      node.removeEventListener('scroll', handleScroll)
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [updateIndicators])

  useEffect(() => {
    updateIndicators()
  }, [children, updateIndicators])

  const handleMouseEnter = () => {
    onActivate(containerRef.current)
  }

  const handleMouseLeave = () => {
    onActivate(null)
  }

  return (
    <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {showLeft && (
        <div
          className="pointer-events-none absolute left-0 top-0 bottom-0 w-8"
          style={{
            background: `linear-gradient(90deg, ${theme.colors.overlay.dark} 0%, transparent 100%)`
          }}
        />
      )}
      {showRight && (
        <div
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-8"
          style={{
            background: `linear-gradient(270deg, ${theme.colors.overlay.dark} 0%, transparent 100%)`
          }}
        />
      )}
      <div className="overflow-x-auto" ref={setContainerRef}>
        {children}
      </div>
    </div>
  )
}

export interface DiffViewerProps {
  files: ChangedFile[]
  selectedFile: string | null
  allFileDiffs: Map<string, FileDiffData>
  fileError: string | null
  branchInfo: {
    currentBranch: string
    baseBranch: string
    baseCommit: string
    headCommit: string
  } | null
  expandedSectionsByFile: Map<string, Set<number>>
  isLargeDiffMode: boolean
  visibleFileSet: Set<string>
  renderedFileSet: Set<string>
  loadingFiles: Set<string>
  observerRef: React.MutableRefObject<IntersectionObserver | null>
  scrollContainerRef: React.RefObject<HTMLDivElement>
  fileRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  fileBodyHeights: Map<string, number>
  onFileBodyHeightChange: (filePath: string, height: number) => void
  getCommentsForFile: (filePath: string) => ReviewCommentThread[]
  highlightCode: (filePath: string, lineKey: string, code: string) => string
  toggleCollapsed: (filePath: string, index: number) => void
  handleLineMouseDown: (payload: { lineNum: number; side: 'old' | 'new'; filePath: string; event: React.MouseEvent }) => void
  handleLineMouseEnter: (payload: { lineNum: number; side: 'old' | 'new'; filePath: string }) => void
  handleLineMouseLeave: (payload: { filePath: string }) => void
  handleLineMouseUp: (payload: { event: React.MouseEvent | MouseEvent; filePath: string }) => void
  lineSelection: {
    isLineSelected: (filePath: string, lineNum: number, side: 'old' | 'new') => boolean
    selection: LineSelection | null
  }
  onCopyLine?: (payload: { filePath: string; lineNumber: number; side: 'old' | 'new' }) => void
  onCopyCode?: (payload: { filePath: string; text: string }) => void
  onCopyFilePath?: (filePath: string) => void
  onDiscardFile?: (filePath: string) => void
  onStartCommentFromContext?: (payload: { filePath: string; lineNumber: number; side: 'old' | 'new' }) => void
}

export function DiffViewer({
  files,
  selectedFile,
  allFileDiffs,
  fileError,
  branchInfo,
  expandedSectionsByFile,
  isLargeDiffMode,
  visibleFileSet,
  renderedFileSet,
  loadingFiles,
  observerRef,
  scrollContainerRef,
  fileRefs,
  fileBodyHeights,
  onFileBodyHeightChange,
  getCommentsForFile,
  highlightCode,
  toggleCollapsed,
  handleLineMouseDown,
  handleLineMouseEnter,
  handleLineMouseLeave,
  handleLineMouseUp,
  lineSelection,
  onCopyLine,
  onCopyCode,
  onCopyFilePath,
  onDiscardFile,
  onStartCommentFromContext
}: DiffViewerProps) {
  const resizeObserversRef = useRef<Map<string, ResizeObserver>>(new Map())
  const bodyRefCallbacksRef = useRef<Map<string, (node: HTMLDivElement | null) => void>>(new Map())

  useEffect(() => {
    const observers = resizeObserversRef.current
    const callbacks = bodyRefCallbacksRef.current
    return () => {
      observers.forEach(observer => observer.disconnect())
      observers.clear()
      callbacks.clear()
    }
  }, [])

  const attachDiffBodyRef = useCallback((filePath: string, node: HTMLDivElement | null) => {
    const observers = resizeObserversRef.current
    const existingObserver = observers.get(filePath)
    if (existingObserver) {
      existingObserver.disconnect()
      observers.delete(filePath)
    }

    if (!node) {
      return
    }

    const handleHeightChange = (height: number) => {
      onFileBodyHeightChange(filePath, Math.max(0, Math.round(height)))
    }

    if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
      const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
          handleHeightChange(entry.contentRect.height)
        }
      })
      observer.observe(node)
      observers.set(filePath, observer)
    } else {
      // Fallback for test environments without ResizeObserver support
      handleHeightChange(node.getBoundingClientRect().height)
    }
  }, [onFileBodyHeightChange])

  const getDiffBodyRef = useCallback((filePath: string) => {
    const callbacks = bodyRefCallbacksRef.current
    if (!callbacks.has(filePath)) {
      callbacks.set(filePath, (node) => attachDiffBodyRef(filePath, node))
    }
    return callbacks.get(filePath)!
  }, [attachDiffBodyRef])
  
  const activeHorizontalRegionRef = useRef<HTMLDivElement | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const getMenuPosition = useCallback((event: React.MouseEvent) => {
    const viewportWidth = document.documentElement?.clientWidth ?? window.innerWidth
    const viewportHeight = document.documentElement?.clientHeight ?? window.innerHeight
    const menuWidth = 240
    const menuHeight = 200
    let x = event.clientX
    let y = event.clientY

    if (x + menuWidth > viewportWidth) {
      x = Math.max(12, viewportWidth - menuWidth - 12)
    }
    if (y + menuHeight > viewportHeight) {
      y = Math.max(12, viewportHeight - menuHeight - 12)
    }

    return { x, y }
  }, [])

  const openContextMenu = useCallback((event: React.MouseEvent, state: ContextMenuInput) => {
    event.preventDefault()
    event.stopPropagation()

    const position = getMenuPosition(event)
    const nextState = { ...state, position } as ContextMenuState
    setContextMenu(nextState)
  }, [getMenuPosition])

  const handleLineNumberContextMenu = useCallback((filePath: string, payload: { event: React.MouseEvent<HTMLTableCellElement>, lineNumber: number, side: 'old' | 'new' }) => {
    openContextMenu(payload.event, {
      kind: 'line',
      filePath,
      lineNumber: payload.lineNumber,
      side: payload.side
    })
  }, [openContextMenu])

  const handleCodeContextMenu = useCallback((filePath: string, payload: { event: React.MouseEvent<HTMLTableCellElement>, lineNumber: number, side: 'old' | 'new', content: string }) => {
    openContextMenu(payload.event, {
      kind: 'line',
      filePath,
      lineNumber: payload.lineNumber,
      side: payload.side,
      content: payload.content
    })
  }, [openContextMenu])

  const handleFileContextMenu = useCallback((event: React.MouseEvent, filePath: string) => {
    openContextMenu(event, { kind: 'file', filePath })
  }, [openContextMenu])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = activeHorizontalRegionRef.current
      if (!target) return
      event.preventDefault()
      const direction = event.key === 'ArrowRight' ? 1 : -1
      target.scrollBy({ left: direction * 120, behavior: 'smooth' })
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  useEffect(() => {
    if (!contextMenu) return

    const handleClose = () => closeContextMenu()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu()
      }
    }

    document.addEventListener('click', handleClose, true)
    document.addEventListener('contextmenu', handleClose)
    document.addEventListener('keydown', handleKey, true)

    return () => {
      document.removeEventListener('click', handleClose, true)
      document.removeEventListener('contextmenu', handleClose)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [contextMenu, closeContextMenu])

  const renderContextMenu = useCallback(() => {
    if (!contextMenu) return null

    const items: Array<{ key: string; label: string; action: () => void }> = []

    if (contextMenu.kind === 'line') {
      if (onCopyLine) {
        items.push({
          key: 'copy-line-number',
          label: `Copy line ${contextMenu.lineNumber}`,
          action: () => onCopyLine({
            filePath: contextMenu.filePath,
            lineNumber: contextMenu.lineNumber,
            side: contextMenu.side
          })
        })
      }
      if (contextMenu.content && onCopyCode) {
        items.push({
          key: 'copy-line-content',
          label: 'Copy line contents',
          action: () => onCopyCode({
            filePath: contextMenu.filePath,
            text: contextMenu.content!
          })
        })
      }
      if (onStartCommentFromContext) {
        items.push({
          key: 'start-thread',
          label: 'Start comment thread',
          action: () => onStartCommentFromContext({
            filePath: contextMenu.filePath,
            lineNumber: contextMenu.lineNumber,
            side: contextMenu.side
          })
        })
      }
    } else if (contextMenu.kind === 'file') {
      if (onCopyFilePath) {
        items.push({
          key: 'copy-path',
          label: 'Copy file path',
          action: () => onCopyFilePath(contextMenu.filePath)
        })
      }
      if (onDiscardFile) {
        items.push({
          key: 'discard-file',
          label: 'Discard file changes',
          action: () => onDiscardFile(contextMenu.filePath)
        })
      }
    }

    if (items.length === 0) {
      return null
    }

    return (
      <div
        role="menu"
        className="fixed z-50 min-w-[220px] rounded-lg overflow-hidden shadow-xl"
        style={{
          top: contextMenu.position.y,
          left: contextMenu.position.x,
          backgroundColor: theme.colors.background.secondary,
          border: `1px solid ${theme.colors.border.subtle}`
        }}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {items.map(item => (
          <button
            key={item.key}
            role="menuitem"
            className="w-full text-left px-4 py-2 text-sm"
            style={{
              color: theme.colors.text.secondary,
              backgroundColor: 'transparent'
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.backgroundColor = theme.colors.background.hover
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.backgroundColor = 'transparent'
            }}
            onClick={() => {
              item.action()
              closeContextMenu()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    )
  }, [contextMenu, onCopyLine, onCopyCode, onStartCommentFromContext, onCopyFilePath, onDiscardFile, closeContextMenu])
  
  if (!selectedFile && files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <AnimatedText text="loading" size="md" />
      </div>
    )
  }

  if (fileError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-8">
          <div className="text-6xl mb-4 text-slate-600">⚠️</div>
          <div className="text-lg font-medium text-slate-400 mb-2">Cannot Display Diff</div>
          <div className="text-sm text-slate-500">{fileError}</div>
          <div className="text-xs text-slate-600 mt-4">
            This file type cannot be compared in the diff viewer.
          </div>
        </div>
      </div>
    )
  }

  if (selectedFile && allFileDiffs.get(selectedFile)?.isBinary) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center px-8">
          <div className="text-6xl mb-4 text-slate-500">📄</div>
          <div className="text-lg font-medium text-slate-300 mb-2">Binary File</div>
          <div className="text-sm text-slate-400 mb-4">
            {allFileDiffs.get(selectedFile)?.unsupportedReason || "This file cannot be displayed in the diff viewer"}
          </div>
          <div className="text-xs text-slate-500">
            Binary files are not shown to prevent performance issues.
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {branchInfo && (
        <div className="px-4 py-2 text-xs text-slate-400 border-b border-slate-700 bg-slate-950">
          {branchInfo.baseBranch} ({branchInfo.baseCommit.slice(0, 7)}) → {branchInfo.currentBranch} ({branchInfo.headCommit.slice(0, 7)})
        </div>
      )}

      {/* Skeleton placeholder for initial frame to avoid flash of empty content */}
      {allFileDiffs.size === 0 && files.length > 0 && (
        <div className="p-4 text-slate-600">Preparing preview…</div>
      )}

      <div className="flex-1 overflow-auto font-mono text-sm" ref={scrollContainerRef}>
        {/* In large diff mode, only render the selected file */}
        {isLargeDiffMode ? (
          files.filter(f => f.path === selectedFile).map((file) => {
            const fileDiff = allFileDiffs.get(file.path)
            const commentThreads = getCommentsForFile(file.path)
            const commentCount = commentThreads.reduce((sum, thread) => sum + thread.comments.length, 0)
            const isCurrentFile = true
            const expandedSet = expandedSectionsByFile.get(file.path)

            return (
              <div
                key={file.path}
                ref={(el) => {
                  if (el) fileRefs.current.set(file.path, el)
                }}
                className="border-b border-slate-800 last:border-b-0"
              >
                {/* File header */}
                <div
                  className={clsx(
                    "sticky top-0 z-10 bg-slate-950 border-b border-slate-700 px-4 py-3 flex items-center justify-between",
                    isCurrentFile && "bg-slate-900"
                  )}
                  onContextMenu={(event) => handleFileContextMenu(event, file.path)}
                >
                  <div className="flex items-center gap-3">
                    {getFileIcon(file.change_type, file.path)}
                     <div>
                       <div className="font-medium text-sm text-slate-100">{file.path}</div>
                       <div className="text-xs text-slate-400">
                         {file.change_type === 'added' && 'New file'}
                         {file.change_type === 'deleted' && 'Deleted file'}
                         {file.change_type === 'modified' && 'Modified'}
                         {file.change_type === 'renamed' && 'Renamed'}
                       </div>
                     </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {commentCount > 0 && (
                        <div
                          className="flex items-center gap-1 text-xs font-medium"
                          style={{ color: theme.colors.accent.blue.light }}
                        >
                          <VscComment />
                          <span>{commentCount} comment{commentCount > 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </div>
                 </div>

                 {/* File diff content or loading placeholder */}
                {!fileDiff ? (
                  <div className="px-4 py-8 text-center text-slate-500">
                    <AnimatedText text="loading" size="sm" />
                  </div>
                ) : (
                  <HorizontalScrollRegion
                    bodyRef={getDiffBodyRef(file.path)}
                    onActivate={(element) => {
                      activeHorizontalRegionRef.current = element
                    }}
                  >
                    <table className="w-full min-w-max">
                      <tbody>
                    {('diffResult' in fileDiff ? fileDiff.diffResult : []).flatMap((line, idx) => {
                      const globalIdx = `${file.path}-${idx}`
                      const isExpanded = expandedSet?.has(idx) ?? false
                      const lineNum = line.oldLineNumber || line.newLineNumber
                      const side: 'old' | 'new' = line.type === 'removed' ? 'old' : 'new'

                      if (line.isCollapsible) {
                        const rows = []
                        rows.push(
                          <DiffLineRow
                            key={globalIdx}
                            line={line}
                            index={globalIdx}
                            isSelected={false}
                            filePath={file.path}
                            onLineMouseDown={handleLineMouseDown}
                            onLineMouseEnter={handleLineMouseEnter}
                            onLineMouseLeave={handleLineMouseLeave}
                            onLineMouseUp={handleLineMouseUp}
                            onToggleCollapse={() => toggleCollapsed(file.path, idx)}
                            isCollapsed={!isExpanded}
                            highlightedContent={undefined}
                          />
                        )
                        
                        if (isExpanded && line.collapsedLines) {
                          line.collapsedLines.forEach((collapsedLine, collapsedIdx) => {
                            const collapsedLineNum = collapsedLine.oldLineNumber || collapsedLine.newLineNumber
                            const collapsedSide: 'old' | 'new' = collapsedLine.type === 'removed' ? 'old' : 'new'
                            rows.push(
                              <DiffLineRow
                                key={`${globalIdx}-expanded-${collapsedIdx}`}
                                line={collapsedLine}
                                index={`${globalIdx}-${collapsedIdx}`}
                                isSelected={collapsedLineNum ? lineSelection.isLineSelected(file.path, collapsedLineNum, collapsedSide) : false}
                                filePath={file.path}
                                onLineMouseDown={handleLineMouseDown}
                                onLineMouseEnter={handleLineMouseEnter}
                                onLineMouseLeave={handleLineMouseLeave}
                                onLineMouseUp={handleLineMouseUp}
                                highlightedContent={collapsedLine.content !== undefined ? highlightCode(file.path, `${globalIdx}-expanded-${collapsedIdx}`, collapsedLine.content) : undefined}
                                onLineNumberContextMenu={(payload) => handleLineNumberContextMenu(file.path, payload)}
                                onCodeContextMenu={(payload) => handleCodeContextMenu(file.path, payload)}
                              />
                            )
                          })
                        }
                        
                        return rows
                      }
                      
                      return (
                        <DiffLineRow
                          key={globalIdx}
                          line={line}
                          index={globalIdx}
                          isSelected={lineNum ? lineSelection.isLineSelected(file.path, lineNum ?? 0, side) : false}
                          filePath={file.path}
                          onLineMouseDown={handleLineMouseDown}
                          onLineMouseEnter={handleLineMouseEnter}
                          onLineMouseLeave={handleLineMouseLeave}
                          onLineMouseUp={handleLineMouseUp}
                          highlightedContent={line.content !== undefined ? highlightCode(file.path, globalIdx, line.content) : undefined}
                          onLineNumberContextMenu={(payload) => handleLineNumberContextMenu(file.path, payload)}
                          onCodeContextMenu={(payload) => handleCodeContextMenu(file.path, payload)}
                        />
                      )
                    })}
                      </tbody>
                    </table>
                  </HorizontalScrollRegion>
                )}
              </div>
            )
          })
        ) : (
          /* For continuous scroll mode, render all files with virtualization */
          files.map((file) => {
            const fileDiff = allFileDiffs.get(file.path)
            const commentThreads = getCommentsForFile(file.path)
            const commentCount = commentThreads.reduce((sum, thread) => sum + thread.comments.length, 0)
            const isCurrentFile = file.path === selectedFile
            const isLoading = loadingFiles.has(file.path)
            const expandedSet = expandedSectionsByFile.get(file.path)
            const storedHeight = fileBodyHeights.get(file.path)
            const isVisible = visibleFileSet.has(file.path)
            const isRendered = isVisible || renderedFileSet.has(file.path)
            const shouldRenderContent = !!fileDiff && (isCurrentFile || isRendered)
            return (
              <div
                key={file.path}
                data-file-path={file.path}
                ref={(el) => {
                  if (el) {
                    fileRefs.current.set(file.path, el)
                    if (observerRef.current) {
                      observerRef.current.observe(el)
                    }
                  }
                }}
                className="border-b border-slate-800 last:border-b-0"
              >
                {/* File header */}
                <div
                  className={clsx(
                    "sticky top-0 z-10 bg-slate-950 border-b border-slate-700 px-4 py-3 flex items-center justify-between",
                    isCurrentFile && "bg-slate-900"
                  )}
                  onContextMenu={(event) => handleFileContextMenu(event, file.path)}
                >
                  <div className="flex items-center gap-3">
                    {getFileIcon(file.change_type, file.path)}
                    <div>
                      <div className="font-medium text-sm text-slate-100">{file.path}</div>
                      <div className="text-xs text-slate-400">
                        {file.change_type === 'added' && 'New file'}
                        {file.change_type === 'deleted' && 'Deleted file'}
                        {file.change_type === 'modified' && 'Modified'}
                         {file.change_type === 'renamed' && 'Renamed'}
                       </div>
                     </div>
                   </div>
                    <div className="flex items-center gap-2">
                      {commentCount > 0 && (
                        <div
                          className="flex items-center gap-1 text-xs font-medium"
                          style={{ color: theme.colors.accent.blue.light }}
                        >
                          <VscComment />
                          <span>{commentCount} comment{commentCount > 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </div>
                 </div>

                 {/* File diff content with virtualization */}
                {!fileDiff ? (
                  <div className="px-4 py-8 text-center text-slate-500">
                    {isLoading ? (
                      <AnimatedText text="loading" size="sm" />
                    ) : (
                      <div className="text-slate-600">
                        <div className="h-20" />
                      </div>
                    )}
                  </div>
                ) : shouldRenderContent ? (
                  <HorizontalScrollRegion
                    bodyRef={getDiffBodyRef(file.path)}
                    onActivate={(element) => {
                      activeHorizontalRegionRef.current = element
                    }}
                  >
                    <table className="w-full min-w-max">
                      <tbody>
                        {('diffResult' in fileDiff ? fileDiff.diffResult : []).flatMap((line, idx) => {
                          const globalIdx = `${file.path}-${idx}`
                          const isExpanded = expandedSet?.has(idx) ?? false
                          const lineNum = line.oldLineNumber || line.newLineNumber
                          const side: 'old' | 'new' = line.type === 'removed' ? 'old' : 'new'

                          if (line.isCollapsible) {
                            const rows = []
                            rows.push(
                          <DiffLineRow
                            key={globalIdx}
                            line={line}
                            index={globalIdx}
                            isSelected={false}
                            filePath={file.path}
                            onLineMouseDown={handleLineMouseDown}
                            onLineMouseEnter={handleLineMouseEnter}
                            onLineMouseLeave={handleLineMouseLeave}
                            onLineMouseUp={handleLineMouseUp}
                            onToggleCollapse={() => toggleCollapsed(file.path, idx)}
                            isCollapsed={!isExpanded}
                            highlightedContent={undefined}
                          />
                        )

                        if (isExpanded && line.collapsedLines) {
                          line.collapsedLines.forEach((collapsedLine, collapsedIdx) => {
                            const collapsedLineNum = collapsedLine.oldLineNumber || collapsedLine.newLineNumber
                            const collapsedSide: 'old' | 'new' = collapsedLine.type === 'removed' ? 'old' : 'new'
                            rows.push(
                              <DiffLineRow
                                key={`${globalIdx}-expanded-${collapsedIdx}`}
                                line={collapsedLine}
                                index={`${globalIdx}-${collapsedIdx}`}
                                    isSelected={collapsedLineNum ? lineSelection.isLineSelected(file.path, collapsedLineNum, collapsedSide) : false}
                                    filePath={file.path}
                                onLineMouseDown={handleLineMouseDown}
                                onLineMouseEnter={handleLineMouseEnter}
                                onLineMouseLeave={handleLineMouseLeave}
                                onLineMouseUp={handleLineMouseUp}
                                highlightedContent={collapsedLine.content !== undefined ? highlightCode(file.path, `${globalIdx}-expanded-${collapsedIdx}`, collapsedLine.content) : undefined}
                                onLineNumberContextMenu={(payload) => handleLineNumberContextMenu(file.path, payload)}
                                onCodeContextMenu={(payload) => handleCodeContextMenu(file.path, payload)}
                              />
                            )
                              })
                            }

                            return rows
                          }
                          return (
                            <DiffLineRow
                              key={globalIdx}
                              line={line}
                              index={globalIdx}
                              isSelected={lineNum ? lineSelection.isLineSelected(file.path, lineNum ?? 0, side) : false}
                              filePath={file.path}
                              onLineMouseDown={handleLineMouseDown}
                              onLineMouseEnter={handleLineMouseEnter}
                              onLineMouseLeave={handleLineMouseLeave}
                              onLineMouseUp={handleLineMouseUp}
                              highlightedContent={line.content !== undefined ? highlightCode(file.path, globalIdx, line.content) : undefined}
                              onLineNumberContextMenu={(payload) => handleLineNumberContextMenu(file.path, payload)}
                              onCodeContextMenu={(payload) => handleCodeContextMenu(file.path, payload)}
                            />
                          )
                    })}
                      </tbody>
                    </table>
                  </HorizontalScrollRegion>
                ) : (
                  <div className="px-4 py-8 text-sm text-slate-600">
                    <div
                      data-testid="diff-placeholder"
                      className="flex items-center justify-center rounded border border-dashed border-slate-700 bg-slate-900/40 text-xs text-slate-500"
                      style={{ height: Math.max(storedHeight ?? 320, 160) }}
                    >
                      Diff hidden to keep scrolling smooth
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
      {renderContextMenu()}
    </>
  )
}
