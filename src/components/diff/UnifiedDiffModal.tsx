import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from '../../contexts/SelectionContext'
import { useReview } from '../../contexts/ReviewContext'
import { useFocus } from '../../contexts/FocusContext'
import { useLineSelection } from '../../hooks/useLineSelection'
import { getFileLanguage } from '../../utils/diff'
import { loadAllFileDiffs, loadFileDiff, type FileDiffData, type ViewMode } from './loadDiffs'
import { DiffLineRow } from './DiffLineRow'
import { ReviewCommentsList } from './ReviewCommentsList'
import { useReviewComments } from '../../hooks/useReviewComments'
import { 
  VscClose, VscComment, VscSend, VscCheck,
  VscSplitHorizontal, VscListFlat, VscFile,
  VscDiffAdded, VscDiffModified, VscDiffRemoved
} from 'react-icons/vsc'
import clsx from 'clsx'
import hljs from 'highlight.js'
import '../../styles/vscode-dark-theme.css'

interface ChangedFile {
  path: string
  change_type: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'
}

interface UnifiedDiffModalProps {
  filePath: string | null
  isOpen: boolean
  onClose: () => void
}

// FileDiffData type moved to loadDiffs

export function UnifiedDiffModal({ filePath, isOpen, onClose }: UnifiedDiffModalProps) {
  const { selection, setSelection } = useSelection()
  const { currentReview, startReview, addComment, getCommentsForFile, clearReview, removeComment } = useReview()
  const { setFocusForSession, setCurrentFocus } = useFocus()
  const lineSelection = useLineSelection()
  const lineSelectionRef = useRef(lineSelection)
  lineSelectionRef.current = lineSelection
  
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(filePath)
  const [fileError, setFileError] = useState<string | null>(null)
  const [branchInfo, setBranchInfo] = useState<{ 
    currentBranch: string
    baseBranch: string
    baseCommit: string
    headCommit: string 
  } | null>(null)
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0)
  const [allFileDiffs, setAllFileDiffs] = useState<Map<string, FileDiffData>>(new Map())
  const [loadingAllFiles, setLoadingAllFiles] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const rightScrollContainerRef = useRef<HTMLDivElement>(null)
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const suppressAutoSelectRef = useRef(false)
  const leftScrollRafRef = useRef<number | null>(null)
  const rightScrollRafRef = useRef<number | null>(null)
  const didInitialScrollRef = useRef(false)
  const lastInitialFilePathRef = useRef<string | null>(null)
  
  const [viewMode, setViewMode] = useState<ViewMode>('unified')
  const [visibleFilePath, setVisibleFilePath] = useState<string | null>(null)
  const [showCommentForm, setShowCommentForm] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<string | number>>(new Set())
  const [commentFormPosition, setCommentFormPosition] = useState<{ x: number, y: number } | null>(null)
  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  const LARGE_FILES_THRESHOLD = 30
  const LARGE_CHANGED_LINES_THRESHOLD = 10000

  // Decide large diff mode early so downstream hooks can use it
  const isLargeDiffMode = useMemo(() => {
    if (files.length >= LARGE_FILES_THRESHOLD) return true
    let totalChanged = 0
    allFileDiffs.forEach((d) => {
      const count = (d as any).changedLinesCount as number | undefined
      if (typeof count === 'number') totalChanged += count
    })
    return totalChanged > LARGE_CHANGED_LINES_THRESHOLD
  }, [files.length, allFileDiffs])

  // Virtualization: compute per-file estimated heights and render a sliding window
  const fileHeightsRef = useRef<Map<string, number>>(new Map())
  const [fileWindowStart, setFileWindowStart] = useState(0)
  const [fileWindowEnd, setFileWindowEnd] = useState(0)
  const DEFAULT_FILE_HEIGHT = 320 // px, placeholder before diff is available
  const HEADER_HEIGHT_UNIFIED = 56
  const HEADER_HEIGHT_SPLIT = 40 // sticky header per side; content scroll containers are separate
  const ROW_HEIGHT = 22

  const allFilesTotalHeight = useMemo(() => {
    let total = 0
    const map = fileHeightsRef.current
    for (const f of files) {
      const h = map.get(f.path) ?? DEFAULT_FILE_HEIGHT
      total += h
    }
    return total
  }, [files, allFileDiffs, viewMode])

  const computeFileHeight = useCallback((file: ChangedFile): number => {
    const fd = allFileDiffs.get(file.path)
    if (!fd) return DEFAULT_FILE_HEIGHT
    if (viewMode === 'unified' && 'diffResult' in fd) {
      const rows = fd.diffResult.length
      return HEADER_HEIGHT_UNIFIED + rows * ROW_HEIGHT
    }
    if (viewMode === 'split' && 'splitDiffResult' in fd) {
      const rows = Math.max(fd.splitDiffResult.leftLines.length, fd.splitDiffResult.rightLines.length)
      // Two columns share the same rows; header per column handled by sticky top within each column
      return HEADER_HEIGHT_SPLIT + rows * ROW_HEIGHT
    }
    return DEFAULT_FILE_HEIGHT
  }, [allFileDiffs, viewMode])

  useEffect(() => {
    const map = fileHeightsRef.current
    let changed = false
    for (const f of files) {
      const h = computeFileHeight(f)
      if (map.get(f.path) !== h) {
        map.set(f.path, h)
        changed = true
      }
    }
    if (changed) {
      // Trigger dependent memo recomputation via state nudges if necessary
      setFileWindowEnd((prev) => prev)
    }
  }, [files, allFileDiffs, viewMode, computeFileHeight])

  const computeWindowForScrollTop = useCallback((scrollTop: number, viewportHeight: number) => {
    // Find first file index intersecting scrollTop
    let acc = 0
    let start = 0
    for (; start < files.length; start++) {
      const h = fileHeightsRef.current.get(files[start].path) ?? DEFAULT_FILE_HEIGHT
      if (acc + h > scrollTop) break
      acc += h
    }
    // Extend until we fill viewport + buffer
    const buffer = 800
    let end = start
    let used = 0
    while (end < files.length && used < viewportHeight + buffer) {
      const h = fileHeightsRef.current.get(files[end].path) ?? DEFAULT_FILE_HEIGHT
      used += h
      end++
    }
    // Add small overscan
    const overscan = 2
    start = Math.max(0, start - overscan)
    end = Math.min(files.length, end + overscan)
    setFileWindowStart(start)
    setFileWindowEnd(end)
  }, [files])

  // Ensure initial window is computed as soon as container is laid out or data changes
  useEffect(() => {
    if (!isOpen) return
    const el = scrollContainerRef.current
    const vh = (el?.clientHeight ?? window.innerHeight) || 800
    // Defer to next frame to let layout settle
    requestAnimationFrame(() => {
      computeWindowForScrollTop(0, vh)
    })
  }, [isOpen, files.length, viewMode, allFileDiffs])
  
  const sessionName: string | null = selection.kind === 'session' ? (selection.payload as string) : null
  
  // Helper to check if a line has comments
  const getCommentForLine = useCallback((lineNum: number | undefined, side: 'old' | 'new') => {
    if (!lineNum || !selectedFile) return null
    const comments = getCommentsForFile(selectedFile)
    return comments.find(c => 
      c.side === side && 
      lineNum >= c.lineRange.start && 
      lineNum <= c.lineRange.end
    )
  }, [selectedFile, getCommentsForFile])
  
  // Show comment form whenever there's a selection (but not while dragging)
  useEffect(() => {
    if (lineSelection.selection && !isDraggingSelection) {
      setShowCommentForm(true)
    } else if (!lineSelection.selection) {
      setShowCommentForm(false)
      setCommentFormPosition(null)
    }
  }, [lineSelection.selection, isDraggingSelection])

  useEffect(() => {
    setSelectedFile(filePath)
  }, [filePath])

  useEffect(() => {
    if (isOpen && sessionName && (!currentReview || currentReview.sessionName !== sessionName)) {
      startReview(sessionName)
    }
  }, [isOpen, sessionName, currentReview, startReview])

  const loadAll = useCallback(async (fileList: ChangedFile[]) => {
    if (!hasLoadedOnce) setLoadingAllFiles(true)
    try {
      const newDiffs = await loadAllFileDiffs(sessionName, fileList, viewMode, 4)
      setAllFileDiffs(newDiffs)
      setHasLoadedOnce(true)
    } catch (error) {
      console.error('Failed to load all file diffs:', error)
    } finally {
      setLoadingAllFiles(false)
    }
  }, [sessionName, viewMode, hasLoadedOnce])

  const loadChangedFiles = useCallback(async () => {
    try {
      const changedFiles = await invoke<ChangedFile[]>('get_changed_files_from_main', { sessionName })
      setFiles(changedFiles)
      
      // Prime initial selection
      let initialIndex = 0
      let initialPath: string | null = filePath || null
      if (changedFiles.length > 0) {
        if (!initialPath) initialPath = changedFiles[0].path
        const found = changedFiles.findIndex(f => f.path === initialPath)
        initialIndex = found >= 0 ? found : 0
      }

      if (initialPath) {
        setSelectedFile(initialPath)
        setSelectedFileIndex(initialIndex)
        // Load only the initially selected file first for fast TTI
        try {
          const primary = await loadFileDiff(sessionName, changedFiles[initialIndex], viewMode)
          setAllFileDiffs(new Map([[initialPath, primary]]))
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          setFileError(msg)
        }
      }

      // Load remaining diffs in the background with concurrency
      loadAll(changedFiles).then(() => {
        // loadAll already sets state, nothing to do here
      })
      
      // Auto-select first file when opening
      // handled above
      
      const currentBranch = await invoke<string>('get_current_branch_name', { sessionName })
      const baseBranch = await invoke<string>('get_base_branch_name', { sessionName })
      const [baseCommit, headCommit] = await invoke<[string, string]>('get_commit_comparison_info', { sessionName })
      
      setBranchInfo({ currentBranch, baseBranch, baseCommit, headCommit })
    } catch (error) {
      console.error('Failed to load changed files:', error)
    }
  }, [sessionName, filePath, loadAll])

  const scrollToFile = useCallback((path: string, index?: number) => {
    // Temporarily suppress auto-selection while we programmatically scroll
    suppressAutoSelectRef.current = true
    setSelectedFile(path)
    setFileError(null)
    if (index !== undefined) {
      setSelectedFileIndex(index)
    }
    
    // Scroll to the file section with proper sticky offsets
    // Defer to next frame to ensure styling/layout updates are applied
    if (isLargeDiffMode) {
      // In large diff mode we render only the selected file; nothing to scroll
      window.setTimeout(() => { suppressAutoSelectRef.current = false }, 150)
      return
    }
    requestAnimationFrame(() => {
      const fileElement = fileRefs.current.get(path)
      const container = viewMode === 'split' ? rightScrollContainerRef.current : scrollContainerRef.current
      if (fileElement && container) {
        const containerRect = container.getBoundingClientRect()
        const elementRect = fileElement.getBoundingClientRect()
        const stickyOffsetPx = viewMode === 'split' ? 28 /* tailwind top-7 */ : 0
        const delta = elementRect.top - containerRect.top
        container.scrollTop += delta - stickyOffsetPx
      }
    })
    
    lineSelectionRef.current.clearSelection()
    setShowCommentForm(false)
    setCommentFormPosition(null)
    // Re-enable auto-selection shortly after scrolling completes
    window.setTimeout(() => {
      suppressAutoSelectRef.current = false
    }, 250)
  }, [viewMode, isLargeDiffMode])

  // Auto-select file while user scrolls without affecting scroll position
  useEffect(() => {
    if (!isOpen) return
    if (isLargeDiffMode) return // no auto selection on scroll when only one file is rendered
    const updateSelectionForRoot = (rootEl: HTMLElement, rafRef: React.MutableRefObject<number | null>) => {
      if (suppressAutoSelectRef.current) return
      if (files.length === 0) return
      if (rafRef.current !== null) return
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null
        const rootTop = rootEl.getBoundingClientRect().top
        let bestPath: string | null = null
        let bestDist = Number.POSITIVE_INFINITY
        for (const file of files) {
          const el = fileRefs.current.get(file.path)
          if (!el) continue
          const rect = el.getBoundingClientRect()
          const dist = Math.abs(rect.top - rootTop)
          if (dist < bestDist) {
            bestDist = dist
            bestPath = file.path
          }
        }
        if (bestPath && bestPath !== visibleFilePath) {
          setVisibleFilePath(bestPath)
        }
      })
    }

    const leftRoot = scrollContainerRef.current
    const rightRoot = viewMode === 'split' ? rightScrollContainerRef.current : null
    if (!leftRoot && !rightRoot) return

    const onLeftScroll = () => leftRoot && updateSelectionForRoot(leftRoot, leftScrollRafRef)
    const onRightScroll = () => rightRoot && updateSelectionForRoot(rightRoot, rightScrollRafRef)

    leftRoot?.addEventListener('scroll', onLeftScroll, { passive: true })
    rightRoot?.addEventListener('scroll', onRightScroll, { passive: true })

    // Initial sync once content is ready
    if (leftRoot) updateSelectionForRoot(leftRoot, leftScrollRafRef)
    if (rightRoot) updateSelectionForRoot(rightRoot, rightScrollRafRef)

    return () => {
      leftRoot?.removeEventListener('scroll', onLeftScroll)
      rightRoot?.removeEventListener('scroll', onRightScroll)
      if (leftScrollRafRef.current != null) {
        cancelAnimationFrame(leftScrollRafRef.current)
        leftScrollRafRef.current = null
      }
      if (rightScrollRafRef.current != null) {
        cancelAnimationFrame(rightScrollRafRef.current)
        rightScrollRafRef.current = null
      }
    }
  }, [isOpen, viewMode, files, visibleFilePath, isLargeDiffMode])

  useEffect(() => {
    if (isOpen) {
      loadChangedFiles()
    } else {
      setHasLoadedOnce(false)
      setLoadingAllFiles(true)
    }
  }, [isOpen, loadChangedFiles])

  // Recompute diffs when switching view mode
  useEffect(() => {
    if (!isOpen || files.length === 0) return
    // Keep selected file diff, then reload all for current view
    loadAll(files).then(() => {})
  }, [viewMode])

  useEffect(() => {
    // Reset initial scroll state when modal re-opens or when a different file is passed in
    if (!isOpen) {
      didInitialScrollRef.current = false
      lastInitialFilePathRef.current = null
      return
    }
    if (filePath !== lastInitialFilePathRef.current) {
      didInitialScrollRef.current = false
    }
    if (isOpen && filePath && !didInitialScrollRef.current) {
      const targetPath = filePath
      suppressAutoSelectRef.current = true
      setTimeout(() => {
        const fileElement = fileRefs.current.get(targetPath)
        const container = viewMode === 'split' ? rightScrollContainerRef.current : scrollContainerRef.current
        if (fileElement && container) {
          const containerRect = container.getBoundingClientRect()
          const elementRect = fileElement.getBoundingClientRect()
          const stickyOffsetPx = viewMode === 'split' ? 28 : 0
          const delta = elementRect.top - containerRect.top
          container.scrollTop += delta - stickyOffsetPx
        }
        window.setTimeout(() => { suppressAutoSelectRef.current = false }, 250)
      }, 100)
      didInitialScrollRef.current = true
      lastInitialFilePathRef.current = filePath
    }
  }, [isOpen, filePath, viewMode])

  // Keyboard handler moved below after handleFinishReview is defined


  const language = useMemo(() => getFileLanguage(selectedFile || ''), [selectedFile])
  const HIGHLIGHT_LINE_CAP = 3000

  const highlightCacheRef = useRef<Map<string, string>>(new Map())
  const highlightCode = useCallback((code: string) => {
    if (!code) return ''
    // Disable highlighting when too many changed lines in file to avoid jank
    if (selectedFile) {
      const fd = allFileDiffs.get(selectedFile)
      if ((fd as any)?.changedLinesCount && (fd as any).changedLinesCount > HIGHLIGHT_LINE_CAP) {
        return code
      }
    }
    const langKey = language || 'auto'
    const cacheKey = `${langKey}::${code}`
    const cache = highlightCacheRef.current
    const cached = cache.get(cacheKey)
    if (cached) return cached
    try {
      const highlighted = language && hljs.getLanguage(language)
        ? hljs.highlight(code, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(code).value
      // Simple cap to avoid unbounded growth
      if (cache.size > 10000) cache.clear()
      cache.set(cacheKey, highlighted)
      return highlighted
    } catch {
      return code
    }
  }, [language])

  // Performance marks to capture compute and render timings (visible in devtools Timeline)
  useEffect(() => {
    if (!isOpen) return
    performance.mark('udm-open')
    return () => {
      performance.mark('udm-close')
      performance.measure('udm-open-duration', 'udm-open', 'udm-close')
    }
  }, [isOpen])

  const handleLineMouseDown = useCallback((lineNum: number, side: 'old' | 'new', event: React.MouseEvent) => {
    event.preventDefault()
    setIsDraggingSelection(true)
    
    // Start new selection
    lineSelection.handleLineClick(lineNum, side, event)
    
    // Don't set position here - we'll calculate it after selection is complete
  }, [lineSelection])

  const handleLineMouseEnter = useCallback((lineNum: number, side: 'old' | 'new') => {
    if (isDraggingSelection && lineSelection.selection && lineSelection.selection.side === side) {
      // Extend selection while dragging
      lineSelection.extendSelection(lineNum, side)
    }
  }, [isDraggingSelection, lineSelection])

  const handleLineMouseUp = useCallback((event: React.MouseEvent) => {
    if (isDraggingSelection) {
      setIsDraggingSelection(false)
      
      // Always use the mouse position from the event
      if (lineSelection.selection) {
        setCommentFormPosition({ 
          x: window.innerWidth - 420, // Right-aligned with some margin
          y: event.clientY + 10 
        })
      }
    }
  }, [isDraggingSelection, lineSelection.selection])

  // Global mouse up handler
  useEffect(() => {
    if (isDraggingSelection) {
      const handleGlobalMouseUp = (e: MouseEvent) => {
        setIsDraggingSelection(false)
        // Use the global mouse event position when mouseup happens outside the button
        if (lineSelection.selection) {
          setCommentFormPosition({ 
            x: window.innerWidth - 420,
            y: e.clientY + 10 
          })
        }
      }
      document.addEventListener('mouseup', handleGlobalMouseUp)
      return () => document.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [isDraggingSelection, lineSelection.selection])

  const toggleCollapsed = useCallback((idx: string | number) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      const key = typeof idx === 'string' ? idx : idx
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])


  const handleSubmitComment = useCallback((text: string) => {
    if (!lineSelection.selection || !selectedFile) return
    
    const fileDiff = allFileDiffs.get(selectedFile)
    if (!fileDiff) return
    
    const lines = lineSelection.selection.side === 'old' 
      ? fileDiff.mainContent.split('\n')
      : fileDiff.worktreeContent.split('\n')
    
    const selectedText = lines
      .slice(lineSelection.selection.startLine - 1, lineSelection.selection.endLine)
      .join('\n')
    
    addComment({
      filePath: selectedFile,
      lineRange: {
        start: lineSelection.selection.startLine,
        end: lineSelection.selection.endLine
      },
      side: lineSelection.selection.side,
      selectedText,
      comment: text
    })
    
    setShowCommentForm(false)
    setCommentFormPosition(null)
    lineSelection.clearSelection()
  }, [lineSelection, selectedFile, allFileDiffs, addComment])

  const { formatReviewForPrompt, getConfirmationMessage } = useReviewComments()

  const handleFinishReview = useCallback(async () => {
    if (!currentReview || currentReview.comments.length === 0) return
    if (!sessionName) return

    const reviewText = formatReviewForPrompt(currentReview.comments)
    
    try {
      const terminalId = `session-${sessionName}-top`
      await invoke('write_terminal', { id: terminalId, data: reviewText })
      
      // Focus the session with blue border
      await setSelection({
        kind: 'session',
        payload: sessionName
      })
      setFocusForSession(sessionName, 'claude')
      setCurrentFocus('claude')
      
      // Clear the review after sending
      clearReview()
      
      onClose()
    } catch (error) {
      console.error('Failed to send review to terminal:', error)
    }
  }, [currentReview, sessionName, formatReviewForPrompt, clearReview, onClose, setSelection, setFocusForSession, setCurrentFocus])

  // Global keyboard shortcuts for the diff modal (placed after handleFinishReview definition)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+Enter to finish review when modal is open
      const isMac = navigator.userAgent.includes('Mac')
      const modifierPressed = isMac ? e.metaKey : e.ctrlKey
      if (isOpen && modifierPressed && e.key === 'Enter') {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        const isEditable = (target as any)?.isContentEditable
        // Avoid triggering while typing in inputs or when comment form is open
        if (!showCommentForm && tag !== 'textarea' && tag !== 'input' && !isEditable) {
          e.preventDefault()
          e.stopPropagation()
          handleFinishReview()
          return
        }
      }

      if (e.key === 'Escape') {
        // Prevent ESC from reaching terminals while modal is open
        e.preventDefault()
        e.stopPropagation()
        if (showCommentForm) {
          setShowCommentForm(false)
          setCommentFormPosition(null)
          lineSelection.clearSelection()
        } else if (isOpen) {
          onClose()
        }
      } else if (isOpen && !showCommentForm) {
        // Arrow key navigation for file list when modal is open and comment form is not shown
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          e.stopPropagation()
          if (selectedFileIndex > 0) {
            const newIndex = selectedFileIndex - 1
            scrollToFile(files[newIndex].path, newIndex)
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          e.stopPropagation()
          if (selectedFileIndex < files.length - 1) {
            const newIndex = selectedFileIndex + 1
            scrollToFile(files[newIndex].path, newIndex)
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true) // capture phase
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, showCommentForm, onClose, lineSelection, selectedFileIndex, files, scrollToFile, handleFinishReview])

  const getFileIcon = (changeType: string) => {
    switch (changeType) {
      case 'added': return <VscDiffAdded className="text-green-500" />
      case 'modified': return <VscDiffModified className="text-yellow-500" />
      case 'deleted': return <VscDiffRemoved className="text-red-500" />
      default: return <VscFile className="text-blue-500" />
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-200"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-slate-950 rounded-xl shadow-2xl w-[95vw] h-[90vh] flex flex-col overflow-hidden border border-slate-800">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold">Git Diff Viewer</h2>
              {selectedFile && (
                <div className="text-sm text-slate-400 font-mono">{selectedFile}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setViewMode('unified')}
                  className={clsx(
                    'px-3 py-1 text-sm rounded transition-colors',
                    viewMode === 'unified' 
                      ? 'bg-slate-700 text-white' 
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  )}
                >
                  <VscListFlat className="inline mr-1" />
                  Unified
                </button>
                <button
                  onClick={() => setViewMode('split')}
                  className={clsx(
                    'px-3 py-1 text-sm rounded transition-colors',
                    viewMode === 'split' 
                      ? 'bg-slate-700 text-white' 
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  )}
                >
                  <VscSplitHorizontal className="inline mr-1" />
                  Split
                </button>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <VscClose className="text-xl" />
              </button>
            </div>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* File list sidebar */}
            <div className="w-80 border-r border-slate-800 bg-slate-900/30 flex flex-col">
              <div className="p-3 border-b border-slate-800">
                <div className="text-sm font-medium mb-1">Changed Files</div>
                <div className="text-xs text-slate-500">{files.length} files</div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {files.map(file => {
                  const commentCount = getCommentsForFile(file.path).length
                  const isLeftSelected = (visibleFilePath ?? selectedFile) === file.path
                  return (
                    <div
                      key={file.path}
                      className={clsx(
                        "px-3 py-2 cursor-pointer hover:bg-slate-800/50 transition-colors",
                        "flex items-center gap-2",
                        isLeftSelected && "bg-slate-800"
                      )}
                      onClick={() => scrollToFile(file.path, files.indexOf(file))}
                    >
                      {getFileIcon(file.change_type)}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{file.path.split('/').pop()}</div>
                        <div className="text-xs text-slate-500 truncate">
                          {file.path.substring(0, file.path.lastIndexOf('/'))}
                        </div>
                      </div>
                      {commentCount > 0 && (
                        <div className="flex items-center gap-1 text-xs text-blue-400">
                          <VscComment />
                          <span>{commentCount}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {currentReview && currentReview.comments.length > 0 && (
                <div className="p-3 border-t border-slate-800 flex flex-col gap-3">
                  <div className="text-xs text-slate-500">
                    <div className="font-medium text-slate-400 mb-2">Review Comments:</div>
                    <ReviewCommentsList 
                      comments={currentReview.comments}
                      onDeleteComment={removeComment}
                    />
                  </div>
                  <div className="space-y-2">
                    <button
                      onClick={handleFinishReview}
                      className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      <VscCheck />
                      <span>
                        Finish Review ({currentReview.comments.length} comment{currentReview.comments.length > 1 ? 's' : ''})
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300">
                        ⌘↩
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(getConfirmationMessage(currentReview.comments.length))) {
                          clearReview()
                        }
                      }}
                      className="w-full px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium transition-colors text-slate-400 hover:text-slate-300"
                    >
                      Cancel Review
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Diff viewer */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {loadingAllFiles && allFileDiffs.size === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-slate-500">Loading diffs...</div>
                </div>
              ) : fileError ? (
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
              ) : (
                <>
              {branchInfo && (
                <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-800 bg-slate-900/30">
                  {branchInfo.baseBranch} ({branchInfo.baseCommit.slice(0, 7)}) → {branchInfo.currentBranch} ({branchInfo.headCommit.slice(0, 7)})
                  {isLargeDiffMode && (
                    <span className="ml-2 text-amber-400">Large diff mode: highlighting reduced, background loading active</span>
                  )}
                </div>
              )}
                  {/* Skeleton placeholder for initial frame to avoid flash of empty content */}
                  {allFileDiffs.size === 0 && files.length > 0 && (
                    <div className="p-4 text-slate-600">Preparing preview…</div>
                  )}

                  {viewMode === 'unified' ? (
                    <div className="flex-1 overflow-auto font-mono text-sm" ref={scrollContainerRef}
                      onScroll={(e) => {
                        const el = e.currentTarget
                        computeWindowForScrollTop(el.scrollTop, el.clientHeight)
                      }}
                      onLoadCapture={(e) => {
                        const el = scrollContainerRef.current
                        if (el) computeWindowForScrollTop(el.scrollTop, el.clientHeight)
                      }}
                    >
                      {/* top spacer */}
                      <div style={{ height: (() => {
                        let h = 0
                        for (let i = 0; i < fileWindowStart; i++) {
                          h += fileHeightsRef.current.get(files[i].path) ?? DEFAULT_FILE_HEIGHT
                        }
                        return h
                      })() }} />
                      {files.slice(fileWindowStart, fileWindowEnd).map((file) => {
                        const fileDiff = allFileDiffs.get(file.path)
                        if (!fileDiff) return null
                        
                        const commentCount = getCommentsForFile(file.path).length
                        const isCurrentFile = file.path === selectedFile
                        
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
                                "sticky top-0 z-10 bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between",
                                isCurrentFile && "bg-slate-800"
                              )}
                            >
                              <div className="flex items-center gap-3">
                                {getFileIcon(file.change_type)}
                                <div>
                                  <div className="font-medium text-sm">{file.path}</div>
                                  <div className="text-xs text-slate-500">
                                    {file.change_type === 'added' && 'New file'}
                                    {file.change_type === 'deleted' && 'Deleted file'}
                                    {file.change_type === 'modified' && 'Modified'}
                                    {file.change_type === 'renamed' && 'Renamed'}
                                  </div>
                                </div>
                              </div>
                              {commentCount > 0 && (
                                <div className="flex items-center gap-1 text-sm text-blue-400">
                                  <VscComment />
                                  <span>{commentCount} comment{commentCount > 1 ? 's' : ''}</span>
                                </div>
                              )}
                            </div>
                            
                            {/* File diff content */}
                            <table className="w-full" style={{ tableLayout: 'fixed' }}>
                              <tbody>
                                {('diffResult' in fileDiff ? fileDiff.diffResult : []).flatMap((line, idx) => {
                                  const globalIdx = `${file.path}-${idx}`
                                  const isExpanded = expandedSections.has(globalIdx)
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
                                        onLineMouseDown={handleLineMouseDown}
                                        onLineMouseEnter={handleLineMouseEnter}
                                        onLineMouseUp={handleLineMouseUp}
                                        onToggleCollapse={() => toggleCollapsed(globalIdx)}
                                        isCollapsed={!isExpanded}
                                        highlightedContent={undefined}
                                      />
                                    )
                                    
                                    if (isExpanded && line.collapsedLines) {
                                      line.collapsedLines.forEach((collapsedLine, collapsedIdx) => {
                                        const collapsedLineNum = collapsedLine.oldLineNumber || collapsedLine.newLineNumber
                                        const collapsedSide: 'old' | 'new' = collapsedLine.type === 'removed' ? 'old' : 'new'
                                        const collapsedComment = getCommentForLine(collapsedLineNum, collapsedSide)
                                         const needsHighlight = collapsedLine.type !== 'unchanged'
                                         rows.push(
                                          <DiffLineRow
                                            key={`${globalIdx}-expanded-${collapsedIdx}`}
                                            line={collapsedLine}
                                            index={`${globalIdx}-${collapsedIdx}`}
                                            isSelected={collapsedLineNum ? lineSelection.isLineSelected(collapsedLineNum, collapsedSide) : false}
                                            onLineMouseDown={handleLineMouseDown}
                                            onLineMouseEnter={handleLineMouseEnter}
                                            onLineMouseUp={handleLineMouseUp}
                                             highlightedContent={needsHighlight && collapsedLine.content ? highlightCode(collapsedLine.content) : undefined}
                                            hasComment={!!collapsedComment}
                                            commentText={collapsedComment?.comment}
                                          />
                                        )
                                      })
                                    }
                                    
                                    return rows
                                  }
                                  
                                  const comment = getCommentForLine(lineNum, side)
                                  const needsHighlight = line.type !== 'unchanged'
                                  return (
                                    <DiffLineRow
                                      key={globalIdx}
                                      line={line}
                                      index={globalIdx}
                                      isSelected={lineNum ? lineSelection.isLineSelected(lineNum, side) : false}
                                      onLineMouseDown={handleLineMouseDown}
                                      onLineMouseEnter={handleLineMouseEnter}
                                      onLineMouseUp={handleLineMouseUp}
                                      highlightedContent={needsHighlight && line.content ? highlightCode(line.content) : undefined}
                                      hasComment={!!comment}
                                      commentText={comment?.comment}
                                    />
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )
                      })}
                      {/* bottom spacer */}
                      <div style={{ height: (() => {
                        let h = 0
                        for (let i = fileWindowEnd; i < files.length; i++) {
                          h += fileHeightsRef.current.get(files[i].path) ?? DEFAULT_FILE_HEIGHT
                        }
                        return h
                      })() }} />
                    </div>
                  ) : (
                    <div className="flex-1 flex overflow-hidden">
                      <div className="flex-1 overflow-auto font-mono text-sm border-r border-slate-800" ref={scrollContainerRef}>
                        <div className="sticky top-0 bg-slate-900 px-3 py-1 text-xs font-medium border-b border-slate-800 z-20">
                          {branchInfo?.baseBranch || 'Base'}
                        </div>
                        {filesToRender.map((file) => {
                          const fileDiff = allFileDiffs.get(file.path)
                          if (!fileDiff) return null
                          
                          return (
                            <div key={`${file.path}-left`} className="border-b border-slate-800 last:border-b-0">
                              <div className="sticky top-7 z-10 bg-slate-900/95 border-b border-slate-800 px-3 py-2">
                                <div className="text-xs text-slate-400">{file.path}</div>
                              </div>
                              <table className="w-full" style={{ tableLayout: 'fixed' }}>
                                <tbody>
                                  {('splitDiffResult' in fileDiff ? fileDiff.splitDiffResult.leftLines : []).map((line, idx) => {
                                    const needsHighlight = line.type !== 'unchanged'
                                    return (
                                      <DiffLineRow
                                        key={`${file.path}-left-${idx}`}
                                        line={line}
                                        index={`${file.path}-left-${idx}`}
                                        isSelected={line.oldLineNumber ? lineSelection.isLineSelected(line.oldLineNumber, 'old') : false}
                                        onLineMouseDown={handleLineMouseDown}
                                        onLineMouseEnter={handleLineMouseEnter}
                                        onLineMouseUp={handleLineMouseUp}
                                        highlightedContent={needsHighlight && line.content ? highlightCode(line.content) : undefined}
                                      />
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex-1 overflow-auto font-mono text-sm" ref={rightScrollContainerRef}>
                        <div className="sticky top-0 bg-slate-900 px-3 py-1 text-xs font-medium border-b border-slate-800 z-20">
                          {branchInfo?.currentBranch || 'Current'}
                        </div>
                        {filesToRender.map((file) => {
                          const fileDiff = allFileDiffs.get(file.path)
                          if (!fileDiff) return null
                          const isCurrentFile = file.path === selectedFile
                          
                          return (
                            <div 
                              key={`${file.path}-right`} 
                              ref={(el) => {
                                if (el && viewMode === 'split') fileRefs.current.set(file.path, el)
                              }}
                              className="border-b border-slate-800 last:border-b-0"
                            >
                              <div className={clsx(
                                "sticky top-7 z-10 bg-slate-900/95 border-b border-slate-800 px-3 py-2 flex items-center justify-between",
                                isCurrentFile && "bg-slate-800"
                              )}>
                                <div className="flex items-center gap-2">
                                  {getFileIcon(file.change_type)}
                                  <div className="text-xs">{file.path}</div>
                                </div>
                              </div>
                              <table className="w-full" style={{ tableLayout: 'fixed' }}>
                                <tbody>
                                  {('splitDiffResult' in fileDiff ? fileDiff.splitDiffResult.rightLines : []).map((line, idx) => {
                                    const needsHighlight = line.type !== 'unchanged'
                                    return (
                                      <DiffLineRow
                                        key={`${file.path}-right-${idx}`}
                                        line={line}
                                        index={`${file.path}-right-${idx}`}
                                        isSelected={line.newLineNumber ? lineSelection.isLineSelected(line.newLineNumber, 'new') : false}
                                        onLineMouseDown={handleLineMouseDown}
                                        onLineMouseEnter={handleLineMouseEnter}
                                        onLineMouseUp={handleLineMouseUp}
                                        highlightedContent={needsHighlight && line.content ? highlightCode(line.content) : undefined}
                                      />
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  
                  {/* Comment form appears near the selected line */}
                  
                  {/* Comment form fixed on the right side */}
                  {showCommentForm && lineSelection.selection && (
                    <>
                      {/* Invisible backdrop to detect clicks outside */}
                      <div 
                        className="fixed inset-0 z-[59]" 
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowCommentForm(false)
                          setCommentFormPosition(null)
                          lineSelection.clearSelection()
                        }}
                      />
                      <div 
                        className="fixed right-4 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-4 w-96 z-[60]"
                        style={{
                          top: commentFormPosition ? Math.min(commentFormPosition.y, window.innerHeight - 300) : '50%',
                          transform: commentFormPosition ? 'none' : 'translateY(-50%)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="text-sm mb-3 text-slate-300">
                          <div className="font-medium mb-1">Add Review Comment</div>
                          <div className="text-xs text-slate-500">
                            {lineSelection.selection.startLine === lineSelection.selection.endLine
                              ? `Line ${lineSelection.selection.startLine}`
                              : `Lines ${lineSelection.selection.startLine}-${lineSelection.selection.endLine}`
                            } • {lineSelection.selection.side === 'old' ? 'Base version' : 'Current version'}
                          </div>
                        </div>
                        <CommentForm
                          onSubmit={handleSubmitComment}
                          onCancel={() => {
                            setShowCommentForm(false)
                            setCommentFormPosition(null)
                            lineSelection.clearSelection()
                          }}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function CommentForm({ onSubmit, onCancel }: { onSubmit: (text: string) => void, onCancel: () => void }) {
  const [text, setText] = useState('')
  
  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text.trim())
      setText('')
    }
  }
  
  return (
    <>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write your comment..."
        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm focus:outline-none focus:border-blue-500 resize-none"
        rows={4}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.metaKey) {
            handleSubmit()
          } else if (e.key === 'Escape') {
            onCancel()
          }
        }}
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium transition-colors flex items-center gap-2"
        >
          <VscSend />
          Submit
        </button>
      </div>
    </>
  )
}