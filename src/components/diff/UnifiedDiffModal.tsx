import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from '../../contexts/SelectionContext'
import { useReview } from '../../contexts/ReviewContext'
import { useFocus } from '../../contexts/FocusContext'
import { ReviewComment } from '../../types/review'
import { useLineSelection } from '../../hooks/useLineSelection'
import { 
  computeUnifiedDiff, 
  addCollapsibleSections, 
  computeSplitDiff,
  getFileLanguage
} from '../../utils/diff'
import { DiffLineRow } from './DiffLineRow'
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

interface FileDiffData {
  file: ChangedFile
  mainContent: string
  worktreeContent: string
  diffResult: ReturnType<typeof addCollapsibleSections>
  splitDiffResult: ReturnType<typeof computeSplitDiff>
}

export function UnifiedDiffModal({ filePath, isOpen, onClose }: UnifiedDiffModalProps) {
  const { selection, setSelection } = useSelection()
  const { currentReview, startReview, addComment, getCommentsForFile, clearReview } = useReview()
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
  
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified')
  const [visibleFilePath, setVisibleFilePath] = useState<string | null>(null)
  const [showCommentForm, setShowCommentForm] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<string | number>>(new Set())
  const [commentFormPosition, setCommentFormPosition] = useState<{ x: number, y: number } | null>(null)
  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  
  const sessionName = selection.kind === 'session' ? selection.payload : null
  
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

  const loadAllFileDiffs = useCallback(async (fileList: ChangedFile[]) => {
    if (!hasLoadedOnce) {
      setLoadingAllFiles(true)
    }
    
    const newDiffs = new Map<string, FileDiffData>()
    
    try {
      for (const file of fileList) {
        try {
          const [mainText, worktreeText] = await invoke<[string, string]>('get_file_diff_from_main', {
            sessionName,
            filePath: file.path
          })
          
          const diffLines = computeUnifiedDiff(mainText, worktreeText)
          const diffResult = addCollapsibleSections(diffLines)
          const splitDiffResult = computeSplitDiff(mainText, worktreeText)
          
          newDiffs.set(file.path, {
            file,
            mainContent: mainText,
            worktreeContent: worktreeText,
            diffResult,
            splitDiffResult
          })
        } catch (fileError) {
          console.warn(`Failed to load diff for ${file.path}:`, fileError)
          if (file.path === selectedFile) {
            const errorMessage = fileError instanceof Error ? fileError.message : String(fileError)
            setFileError(errorMessage)
          }
        }
      }
      
      setAllFileDiffs(newDiffs)
      setHasLoadedOnce(true)
    } catch (error) {
      console.error('Failed to load all file diffs:', error)
    } finally {
      setLoadingAllFiles(false)
    }
  }, [sessionName, selectedFile, hasLoadedOnce])

  const loadChangedFiles = useCallback(async () => {
    try {
      const changedFiles = await invoke<ChangedFile[]>('get_changed_files_from_main', { sessionName })
      setFiles(changedFiles)
      
      // Load all file diffs for continuous scrolling
      await loadAllFileDiffs(changedFiles)
      
      // Auto-select first file when opening
      if (changedFiles.length > 0 && !filePath) {
        setSelectedFile(changedFiles[0].path)
        setSelectedFileIndex(0)
      } else if (filePath) {
        // Find index of pre-selected file
        const index = changedFiles.findIndex(f => f.path === filePath)
        if (index >= 0) {
          setSelectedFileIndex(index)
          setSelectedFile(filePath)
        }
      }
      
      const currentBranch = await invoke<string>('get_current_branch_name', { sessionName })
      const baseBranch = await invoke<string>('get_base_branch_name', { sessionName })
      const [baseCommit, headCommit] = await invoke<[string, string]>('get_commit_comparison_info', { sessionName })
      
      setBranchInfo({ currentBranch, baseBranch, baseCommit, headCommit })
    } catch (error) {
      console.error('Failed to load changed files:', error)
    }
  }, [sessionName, filePath, loadAllFileDiffs])

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
  }, [viewMode])

  // Auto-select file while user scrolls without affecting scroll position
  useEffect(() => {
    if (!isOpen) return

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
  }, [isOpen, viewMode, files, visibleFilePath])

  useEffect(() => {
    if (isOpen) {
      loadChangedFiles()
    } else {
      setHasLoadedOnce(false)
      setLoadingAllFiles(true)
    }
  }, [isOpen, loadChangedFiles])

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

  const highlightCode = useCallback((code: string) => {
    if (!code) return ''
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value
      }
      return hljs.highlightAuto(code).value
    } catch {
      return code
    }
  }, [language])

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

  const handleLineMouseUp = useCallback(() => {
    if (isDraggingSelection) {
      setIsDraggingSelection(false)
      
      // Calculate position based on the selected lines
      if (lineSelection.selection) {
        const endLine = Math.max(lineSelection.selection.startLine, lineSelection.selection.endLine)
        
        // Find the DOM element for the last selected line
        const lineElements = document.querySelectorAll(`[data-line-num="${endLine}"][data-side="${lineSelection.selection.side}"]`)
        if (lineElements.length > 0) {
          const rect = lineElements[0].getBoundingClientRect()
          // Position below the selection, aligned to the right side of the viewport
          setCommentFormPosition({ 
            x: window.innerWidth - 420, // Right-aligned with some margin
            y: rect.bottom + 10 
          })
        }
      }
    }
  }, [isDraggingSelection, lineSelection.selection])

  // Global mouse up handler
  useEffect(() => {
    if (isDraggingSelection) {
      const handleGlobalMouseUp = () => {
        setIsDraggingSelection(false)
      }
      document.addEventListener('mouseup', handleGlobalMouseUp)
      return () => document.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [isDraggingSelection])

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

  const formatReviewForPrompt = useCallback((comments: ReviewComment[]) => {
    let output = '\n# Code Review Comments\n\n'
    
    const commentsByFile = comments.reduce((acc, comment) => {
      if (!acc[comment.filePath]) {
        acc[comment.filePath] = []
      }
      acc[comment.filePath].push(comment)
      return acc
    }, {} as Record<string, ReviewComment[]>)

    for (const [file, fileComments] of Object.entries(commentsByFile)) {
      output += `## ${file}\n\n`
      
      for (const comment of fileComments) {
        output += `### Lines ${comment.lineRange.start}-${comment.lineRange.end} (${comment.side === 'old' ? 'base' : 'current'}):\n`
        output += `\`\`\`\n${comment.selectedText}\n\`\`\`\n`
        output += `**Comment:** ${comment.comment}\n\n`
      }
    }

    return output
  }, [])

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
                <div className="p-3 border-t border-slate-800 space-y-2">
                  <div className="text-xs text-slate-500">
                    <div className="font-medium text-slate-400 mb-1">Review Summary:</div>
                    <div className="space-y-1">
                      {files.map(file => {
                        const fileComments = getCommentsForFile(file.path)
                        if (fileComments.length === 0) return null
                        return (
                          <div key={file.path} className="flex items-center justify-between">
                            <span className="truncate">{file.path.split('/').pop()}</span>
                            <span className="text-blue-400">{fileComments.length} comment{fileComments.length > 1 ? 's' : ''}</span>
                          </div>
                        )
                      }).filter(Boolean)}
                    </div>
                  </div>
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
                    </div>
                  )}
                  
                  {viewMode === 'unified' ? (
                    <div className="flex-1 overflow-auto font-mono text-sm" ref={scrollContainerRef}>
                      {files.map((file) => {
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
                                {fileDiff.diffResult.flatMap((line, idx) => {
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
                                        rows.push(
                                          <DiffLineRow
                                            key={`${globalIdx}-expanded-${collapsedIdx}`}
                                            line={collapsedLine}
                                            index={`${globalIdx}-${collapsedIdx}`}
                                            isSelected={collapsedLineNum ? lineSelection.isLineSelected(collapsedLineNum, collapsedSide) : false}
                                            onLineMouseDown={handleLineMouseDown}
                                            onLineMouseEnter={handleLineMouseEnter}
                                            onLineMouseUp={handleLineMouseUp}
                                            highlightedContent={collapsedLine.content ? highlightCode(collapsedLine.content) : undefined}
                                            hasComment={!!collapsedComment}
                                            commentText={collapsedComment?.comment}
                                          />
                                        )
                                      })
                                    }
                                    
                                    return rows
                                  }
                                  
                                  const comment = getCommentForLine(lineNum, side)
                                  return (
                                    <DiffLineRow
                                      key={globalIdx}
                                      line={line}
                                      index={globalIdx}
                                      isSelected={lineNum ? lineSelection.isLineSelected(lineNum, side) : false}
                                      onLineMouseDown={handleLineMouseDown}
                                      onLineMouseEnter={handleLineMouseEnter}
                                      onLineMouseUp={handleLineMouseUp}
                                      highlightedContent={line.content ? highlightCode(line.content) : undefined}
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
                    </div>
                  ) : (
                    <div className="flex-1 flex overflow-hidden">
                      <div className="flex-1 overflow-auto font-mono text-sm border-r border-slate-800" ref={scrollContainerRef}>
                        <div className="sticky top-0 bg-slate-900 px-3 py-1 text-xs font-medium border-b border-slate-800 z-20">
                          {branchInfo?.baseBranch || 'Base'}
                        </div>
                        {files.map((file) => {
                          const fileDiff = allFileDiffs.get(file.path)
                          if (!fileDiff) return null
                          
                          return (
                            <div key={`${file.path}-left`} className="border-b border-slate-800 last:border-b-0">
                              <div className="sticky top-7 z-10 bg-slate-900/95 border-b border-slate-800 px-3 py-2">
                                <div className="text-xs text-slate-400">{file.path}</div>
                              </div>
                              <table className="w-full" style={{ tableLayout: 'fixed' }}>
                                <tbody>
                                  {fileDiff.splitDiffResult.leftLines.map((line, idx) => (
                                    <DiffLineRow
                                      key={`${file.path}-left-${idx}`}
                                      line={line}
                                      index={`${file.path}-left-${idx}`}
                                      isSelected={line.oldLineNumber ? lineSelection.isLineSelected(line.oldLineNumber, 'old') : false}
                                      onLineMouseDown={handleLineMouseDown}
                                      onLineMouseEnter={handleLineMouseEnter}
                                      onLineMouseUp={handleLineMouseUp}
                                      highlightedContent={line.content ? highlightCode(line.content) : undefined}
                                    />
                                  ))}
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
                        {files.map((file) => {
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
                                  {fileDiff.splitDiffResult.rightLines.map((line, idx) => (
                                    <DiffLineRow
                                      key={`${file.path}-right-${idx}`}
                                      line={line}
                                      index={`${file.path}-right-${idx}`}
                                      isSelected={line.newLineNumber ? lineSelection.isLineSelected(line.newLineNumber, 'new') : false}
                                      onLineMouseDown={handleLineMouseDown}
                                      onLineMouseEnter={handleLineMouseEnter}
                                      onLineMouseUp={handleLineMouseUp}
                                      highlightedContent={line.content ? highlightCode(line.content) : undefined}
                                    />
                                  ))}
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