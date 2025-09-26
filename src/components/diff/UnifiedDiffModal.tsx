import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { useSelection } from '../../contexts/SelectionContext'
import { useReview } from '../../contexts/ReviewContext'
import { useFocus } from '../../contexts/FocusContext'
import { useLineSelection } from '../../hooks/useLineSelection'
import { useDiffHover } from '../../hooks/useDiffHover'
// getFileLanguage now comes from Rust backend via fileInfo in diff responses
import { loadFileDiff, type FileDiffData } from './loadDiffs'
import { useReviewComments } from '../../hooks/useReviewComments'
import { DiffFileExplorer, ChangedFile } from './DiffFileExplorer'
import { DiffViewer } from './DiffViewer'
import {
  VscClose, VscSend, VscListFlat, VscListSelection, VscCollapseAll, VscExpandAll
} from 'react-icons/vsc'
import hljs from 'highlight.js'
import { SearchBox } from '../common/SearchBox'
import '../../styles/vscode-dark-theme.css'
import { logger } from '../../utils/logger'
// AnimatedText imported elsewhere in this file; remove unused import here
import { useSessions } from '../../contexts/SessionsContext'
import { mapSessionUiState } from '../../utils/sessionFilters'
import { DiffSessionActions } from './DiffSessionActions'
import { useKeyboardShortcutsConfig } from '../../contexts/KeyboardShortcutsContext'
import { KeyboardShortcutAction, KeyboardShortcutConfig } from '../../keyboardShortcuts/config'
import { detectPlatformSafe, isShortcutForAction } from '../../keyboardShortcuts/helpers'
import type { Platform } from '../../keyboardShortcuts/matcher'

// ChangedFile type now imported from DiffFileExplorer

interface UnifiedDiffModalProps {
  filePath: string | null
  isOpen: boolean
  onClose: () => void
}

interface DiffViewPreferences {
  continuous_scroll: boolean
  compact_diffs: boolean
}

// FileDiffData type moved to loadDiffs

export function UnifiedDiffModal({ filePath, isOpen, onClose }: UnifiedDiffModalProps) {
  const { selection, setSelection, terminals } = useSelection()
  const selectedKind = selection.kind
  const terminalTop = terminals.top
  const { currentReview, startReview, addComment, getCommentsForFile, clearReview, removeComment } = useReview()
  const { setFocusForSession, setCurrentFocus } = useFocus()
  const { sessions, reloadSessions } = useSessions()
  const { config: keyboardShortcutConfig } = useKeyboardShortcutsConfig()
  const platform = useMemo(() => detectPlatformSafe(), [])
  const lineSelection = useLineSelection()
  const lineSelectionRef = useRef(lineSelection)
  lineSelectionRef.current = lineSelection
  
  const { setHoveredLineInfo, clearHoveredLine, useHoverKeyboardShortcuts } = useDiffHover()
  
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
  // Removed bulk loading states - now using lazy loading for better performance
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const suppressAutoSelectRef = useRef(false)
  const leftScrollRafRef = useRef<number | null>(null)
  const didInitialScrollRef = useRef(false)
  const lastInitialFilePathRef = useRef<string | null>(null)
  
  // Always use unified view mode - split view removed for performance
  const [visibleFilePath, setVisibleFilePath] = useState<string | null>(null)
  const [showCommentForm, setShowCommentForm] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Map<string, Set<number>>>(new Map())
  const [commentFormPosition, setCommentFormPosition] = useState<{ x: number, y: number } | null>(null)
  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  const [continuousScroll, setContinuousScroll] = useState(false)
  const [compactDiffs, setCompactDiffs] = useState(true)
  const [isSearchVisible, setIsSearchVisible] = useState(false)
  const fileBodyHeightsRef = useRef<Map<string, number>>(new Map())
  const [, setFileHeightsVersion] = useState(0)
  
  // Virtual scrolling state for continuous mode
  const [visibleFileSet, setVisibleFileSet] = useState<Set<string>>(new Set())
  const [renderedFileSet, setRenderedFileSet] = useState<Set<string>>(new Set())
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const pendingVisibilityUpdatesRef = useRef<Map<string, boolean>>(new Map())
  const visibilityFrameRef = useRef<number | NodeJS.Timeout | null>(null)
  const recentlyVisibleRef = useRef<string[]>([])

  // Use single file view mode when continuousScroll is disabled
  const isLargeDiffMode = useMemo(() => {
    // When continuousScroll is false, always use single file view
    if (!continuousScroll) return true
    
    // When continuousScroll is true, never use single file view - show all files
    return false
  }, [continuousScroll])

  // Removed virtualization to prevent jumping when diffs load

  // Removed unused variable - was used for virtualization but no longer needed
  // const allFilesTotalHeight = useMemo(() => {
  //   let total = 0
  //   const map = fileHeightsRef.current
  //   for (const f of files) {
  //     const h = map.get(f.path) ?? DEFAULT_FILE_HEIGHT
  //     total += h
  //   }
  //   return total
  // }, [files, allFileDiffs, viewMode])

  const isCommanderView = useCallback(() => selection.kind === 'orchestrator', [selection.kind])
  const sessionName: string | null = selection.kind === 'session' ? (selection.payload as string) : null
  const targetSession = useMemo(() => {
    if (selection.kind !== 'session' || !sessionName) return null
    return sessions.find(s => s.info.session_id === sessionName) ?? null
  }, [selection.kind, sessionName, sessions])
  const canMarkReviewed = useMemo(() => {
    if (!targetSession) return false
    return mapSessionUiState(targetSession.info) === 'running'
  }, [targetSession])
  
  // Helper to check if a line has comments
  const getCommentForLine = useCallback((lineNum: number | undefined, side: 'old' | 'new') => {
    if (!lineNum || !selectedFile) return undefined
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
    if (!isOpen) return
    if (selection.kind === 'orchestrator') {
      if (!currentReview || currentReview.sessionName !== 'orchestrator') {
        startReview('orchestrator')
      }
      return
    }
    if (sessionName && (!currentReview || currentReview.sessionName !== sessionName)) {
      startReview(sessionName)
    }
  }, [isOpen, selection.kind, sessionName, currentReview, startReview])

  
  const toggleContinuousScroll = useCallback(async () => {
    const newValue = !continuousScroll
    
    // Reset state when switching modes
    setAllFileDiffs(new Map())  // Clear all loaded diffs
    setVisibleFilePath(null)    // Reset visible file tracking
    
    // Reset scroll position
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
    
    setContinuousScroll(newValue)
    
    // Re-load the currently selected file after mode switch
    if (selectedFile) {
      const file = files.find(f => f.path === selectedFile)
      if (file) {
        try {
          const diff = await loadFileDiff(sessionName, file, 'unified')
          setAllFileDiffs(new Map([[selectedFile, diff]]))
        } catch (e) {
          logger.error('Failed to reload selected file:', e)
        }
      }
    }
    
    try {
      await invoke(TauriCommands.SetDiffViewPreferences, {
        preferences: { continuous_scroll: newValue, compact_diffs: compactDiffs }
      })
    } catch (err) {
      logger.error('Failed to save diff view preference:', err)
    }
  }, [continuousScroll, selectedFile, files, sessionName, compactDiffs])


  const toggleCompactDiffs = useCallback(async () => {
    const newValue = !compactDiffs
    setCompactDiffs(newValue)

    try {
      await invoke(TauriCommands.SetDiffViewPreferences, {
        preferences: { continuous_scroll: continuousScroll, compact_diffs: newValue }
      })
    } catch (err) {
      logger.error('Failed to save diff view preference:', err)
    }
  }, [compactDiffs, continuousScroll])


   const getChangedFilesForContext = useCallback(async () => {
     if (isCommanderView()) {
       return await invoke<ChangedFile[]>(TauriCommands.GetOrchestratorWorkingChanges)
     }
      return await invoke<ChangedFile[]>(TauriCommands.GetChangedFilesFromMain, { sessionName })
    }, [sessionName, isCommanderView])

  const loadChangedFiles = useCallback(async () => {
     try {
       const changedFiles = await getChangedFilesForContext()
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
           const primary = await loadFileDiff(sessionName, changedFiles[initialIndex], 'unified')
           setAllFileDiffs(prev => {
             const merged = new Map(prev)
             merged.set(initialPath, primary)
             return merged
           })
         } catch (e) {
           const msg = e instanceof Error ? e.message : String(e)
           setFileError(msg)
         }
       }

       // Note: We now use lazy loading - diffs are loaded on-demand when user navigates to them
       // This provides instant modal opening and smooth performance

       const currentBranch = await invoke<string>(TauriCommands.GetCurrentBranchName, { sessionName })
       const baseBranch = await invoke<string>(TauriCommands.GetBaseBranchName, { sessionName })
       const [baseCommit, headCommit] = await invoke<[string, string]>(TauriCommands.GetCommitComparisonInfo, { sessionName })

       setBranchInfo({ currentBranch, baseBranch, baseCommit, headCommit })
     } catch (error) {
       logger.error('Failed to load changed files:', error)
     }
  }, [sessionName, filePath, getChangedFilesForContext, setFiles, setSelectedFile, setSelectedFileIndex, setAllFileDiffs, setFileError, setBranchInfo])

  const scrollToFile = useCallback(async (path: string, index?: number) => {
    // Temporarily suppress auto-selection while we programmatically scroll
    suppressAutoSelectRef.current = true
    setSelectedFile(path)
    setVisibleFilePath(path) // Ensure sidebar highlights correct file
    setFileError(null)
    if (index !== undefined) {
      setSelectedFileIndex(index)
    }
    
    // Lazy load the diff if not already loaded
    if (!allFileDiffs.has(path)) {
      const file = files.find(f => f.path === path)
      if (file) {
        try {
          const diff = await loadFileDiff(sessionName, file, 'unified')
          setAllFileDiffs(prev => {
            const merged = new Map(prev)
            merged.set(path, diff)
            return merged
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          setFileError(msg)
        }
      }
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
      const container = scrollContainerRef.current
      if (fileElement && container) {
        const containerRect = container.getBoundingClientRect()
        const elementRect = fileElement.getBoundingClientRect()
        const stickyOffsetPx = 0
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
  }, [isLargeDiffMode, files, sessionName, allFileDiffs])

  // Set up Intersection Observer for virtual scrolling in continuous mode
  useEffect(() => {
    const pendingUpdates = pendingVisibilityUpdatesRef.current

    const clearPendingFrame = () => {
      if (visibilityFrameRef.current != null) {
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(visibilityFrameRef.current as number)
        } else {
          clearTimeout(visibilityFrameRef.current as NodeJS.Timeout)
        }
        visibilityFrameRef.current = null
      }
    }

    if (!isOpen || isLargeDiffMode) {
      if (observerRef.current) {
        observerRef.current.disconnect()
        observerRef.current = null
      }
      pendingUpdates.clear()
      clearPendingFrame()
      setVisibleFileSet(prev => (prev.size === 0 ? prev : new Set<string>()))
      recentlyVisibleRef.current = []
      setRenderedFileSet(prev => (prev.size === 0 ? prev : new Set<string>()))
      return
    }

    const flushPendingVisibility = () => {
      visibilityFrameRef.current = null
      if (pendingUpdates.size === 0) return
      const updates = new Map(pendingUpdates)
      pendingUpdates.clear()
      setVisibleFileSet(prev => {
        let mutated = false
        const next = new Set(prev)
        updates.forEach((isVisible, path) => {
          if (isVisible) {
            if (!next.has(path)) {
              next.add(path)
              mutated = true
            }
          } else if (next.delete(path)) {
            mutated = true
          }
        })
        return mutated ? next : prev
      })
    }

    const scheduleFlush = () => {
      if (visibilityFrameRef.current != null) return
      const frameCallback = () => flushPendingVisibility()
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        visibilityFrameRef.current = window.requestAnimationFrame(frameCallback)
      } else {
        const timeoutId = setTimeout(() => frameCallback(), 16)
        visibilityFrameRef.current = timeoutId
      }
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          const filePath = entry.target.getAttribute('data-file-path')
          if (filePath) {
            pendingUpdates.set(filePath, entry.isIntersecting)
          }
        })
        scheduleFlush()
      },
      {
        root: scrollContainerRef.current,
        rootMargin: '600px 0px',
        threshold: 0
      }
    )

    observerRef.current = observer

    fileRefs.current.forEach(element => {
      if (element) observer.observe(element)
    })

    return () => {
      observer.disconnect()
      pendingUpdates.clear()
      clearPendingFrame()
      if (observerRef.current === observer) {
        observerRef.current = null
      }
    }
  }, [isOpen, isLargeDiffMode, files])

  useEffect(() => {
    if (visibleFileSet.size === 0) {
      return
    }

    const maxRecent = 4
    const visibleList = Array.from(visibleFileSet)
    const historical = recentlyVisibleRef.current.filter(path => !visibleFileSet.has(path))
    const combined = [...visibleList, ...historical].slice(0, maxRecent)
    recentlyVisibleRef.current = combined
    setRenderedFileSet(new Set(combined))
  }, [visibleFileSet])

  // Load diffs for visible files with buffer zones
  useEffect(() => {
    if (isLargeDiffMode || !isOpen) {
      return
    }

    // Create a file index map for O(1) lookups instead of O(n) finds
    const fileIndexMap = new Map<string, number>()
    const filesByPath = new Map<string, typeof files[0]>()
    files.forEach((file, index) => {
      fileIndexMap.set(file.path, index)
      filesByPath.set(file.path, file)
    })

    const loadQueue = new Set<string>()
    
    // Add visible files to load queue
    visibleFileSet.forEach(path => {
      if (!allFileDiffs.has(path) && !loadingFiles.has(path)) {
        loadQueue.add(path)
      }
    })
    
    // Add buffer files (neighbors of visible files)
    visibleFileSet.forEach(path => {
      const index = fileIndexMap.get(path)
      if (index === undefined) return
      
      // Load previous file
      if (index > 0) {
        const prevPath = files[index - 1].path
        if (!allFileDiffs.has(prevPath) && !loadingFiles.has(prevPath)) {
          loadQueue.add(prevPath)
        }
      }
      // Load next file
      if (index < files.length - 1) {
        const nextPath = files[index + 1].path
        if (!allFileDiffs.has(nextPath) && !loadingFiles.has(nextPath)) {
          loadQueue.add(nextPath)
        }
      }
    })
    
    if (loadQueue.size === 0) return
    
    // Batch load files asynchronously to avoid blocking
    const loadNextBatch = async () => {
      const batch = Array.from(loadQueue).slice(0, 3) // Load max 3 files at once
      const loadPromises = batch.map(async path => {
        const file = filesByPath.get(path)
        if (!file) return null
        
        try {
          const diff = await loadFileDiff(sessionName, file, 'unified')
          return { path, diff }
        } catch (e) {
          logger.error(`Failed to load diff for ${path}:`, e)
          return null
        }
      })
      
      // Mark files as loading
      setLoadingFiles(prev => {
        const next = new Set(prev)
        batch.forEach(path => next.add(path))
        return next
      })
      
      const results = await Promise.all(loadPromises)
      
      // Batch update all diffs at once
      setAllFileDiffs(prev => {
        const next = new Map(prev)
        results.forEach(result => {
          if (result) {
            next.set(result.path, result.diff)
          }
        })
        return next
      })
      
      // Clear loading state
      setLoadingFiles(prev => {
        const next = new Set(prev)
        batch.forEach(path => next.delete(path))
        return next
      })
    }
    
    void loadNextBatch()

  }, [visibleFileSet, files, allFileDiffs, loadingFiles, isLargeDiffMode, isOpen, sessionName])

  // Separate memory management into its own effect with less frequent runs
  useEffect(() => {
    if (isLargeDiffMode || !isOpen) return
    
    const cleanupTimer = setTimeout(() => {
      // Memory management: unload far-away diffs
      const MAX_LOADED_DIFFS = 20
      if (allFileDiffs.size <= MAX_LOADED_DIFFS) return
      
      const keepSet = new Set<string>()
      
      // Keep visible files and their neighbors
      visibleFileSet.forEach(path => {
        keepSet.add(path)
        const index = files.findIndex(f => f.path === path)
        if (index > 0) keepSet.add(files[index - 1].path)
        if (index < files.length - 1) keepSet.add(files[index + 1].path)
      })
      
      // Also keep the selected file
      if (selectedFile) keepSet.add(selectedFile)
      
      // Remove diffs that are far from viewport
      const toRemove: string[] = []
      allFileDiffs.forEach((_, path) => {
        if (!keepSet.has(path)) {
          toRemove.push(path)
        }
      })
      
      // Only remove if we're over the limit
      const removeCount = allFileDiffs.size - MAX_LOADED_DIFFS
      if (removeCount > 0) {
        toRemove.slice(0, removeCount).forEach(path => {
          setAllFileDiffs(prev => {
            const next = new Map(prev)
            next.delete(path)
            return next
          })
        })
      }
    }, 2000) // Run cleanup every 2 seconds, not on every visibility change
    
    return () => clearTimeout(cleanupTimer)
  }, [allFileDiffs, visibleFileSet, files, selectedFile, isLargeDiffMode, isOpen])

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
          // Update selected file to keep sidebar in sync
          setSelectedFile(bestPath)
          const index = files.findIndex(f => f.path === bestPath)
          if (index >= 0) {
            setSelectedFileIndex(index)
          }
        }
      })
    }

    const leftRoot = scrollContainerRef.current
    if (!leftRoot) return

    const onLeftScroll = () => leftRoot && updateSelectionForRoot(leftRoot, leftScrollRafRef)

    leftRoot?.addEventListener('scroll', onLeftScroll, { passive: true })

    // Initial sync once content is ready
    if (leftRoot) updateSelectionForRoot(leftRoot, leftScrollRafRef)

    return () => {
      leftRoot?.removeEventListener('scroll', onLeftScroll)
      if (leftScrollRafRef.current != null) {
        cancelAnimationFrame(leftScrollRafRef.current)
        leftScrollRafRef.current = null
      }
    }
  }, [isOpen, files, visibleFilePath, isLargeDiffMode])

  useEffect(() => {
    if (isOpen) {
      loadChangedFiles()
      // Load user's diff view preference
      invoke<DiffViewPreferences>(TauriCommands.GetDiffViewPreferences)
        .then(prefs => {
          setContinuousScroll(prefs.continuous_scroll)
          setCompactDiffs(prefs.compact_diffs ?? true)
          // If continuous scroll is enabled, load all diffs
          // No need to load all diffs - using lazy loading with viewport detection
        })
        .catch(err => logger.error('Failed to load diff view preferences:', err))
    }
    // No need to reset loading states - using lazy loading now
  }, [isOpen, loadChangedFiles])


  useEffect(() => {
    // Reset initial scroll state when modal re-opens or when a different file is passed in
    if (!isOpen) {
      didInitialScrollRef.current = false
      lastInitialFilePathRef.current = null
      
      pendingVisibilityUpdatesRef.current.clear()
      if (visibilityFrameRef.current != null) {
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(visibilityFrameRef.current as number)
        } else {
          clearTimeout(visibilityFrameRef.current as NodeJS.Timeout)
        }
        visibilityFrameRef.current = null
      }
      
      return
    }
    if (filePath !== lastInitialFilePathRef.current) {
      didInitialScrollRef.current = false
    }
    if (isOpen && filePath && !didInitialScrollRef.current) {
      const targetPath = filePath
      suppressAutoSelectRef.current = true
      
      let suppressTimeoutId: NodeJS.Timeout
      const scrollTimeoutId = setTimeout(() => {
        const fileElement = fileRefs.current.get(targetPath)
        const container = scrollContainerRef.current
        if (fileElement && container) {
          const containerRect = container.getBoundingClientRect()
          const elementRect = fileElement.getBoundingClientRect()
          const stickyOffsetPx = 0
          const delta = elementRect.top - containerRect.top
          container.scrollTop += delta - stickyOffsetPx
        }
        suppressTimeoutId = setTimeout(() => { suppressAutoSelectRef.current = false }, 250)
      }, 100)
      
      didInitialScrollRef.current = true
      lastInitialFilePathRef.current = filePath
      
      return () => {
        clearTimeout(scrollTimeoutId)
        if (suppressTimeoutId) clearTimeout(suppressTimeoutId)
      }
    }
  }, [isOpen, filePath])

  // Keyboard handler moved below after handleFinishReview is defined


  const language = useMemo(() => {
    if (!selectedFile) return undefined
    const diffData = allFileDiffs.get(selectedFile)
    // Get language from Rust backend fileInfo, fallback to path-based detection
    return diffData?.fileInfo?.language || getFileLanguageFromPath(selectedFile)
  }, [selectedFile, allFileDiffs])

  // Fallback function for language detection from file path
  function getFileLanguageFromPath(filePath: string): string | undefined {
    if (!filePath) return undefined
    const ext = filePath.split('.').pop()?.toLowerCase()
    const languageMap: Record<string, string> = {
      'ts': 'typescript', 'tsx': 'typescript',
      'js': 'javascript', 'jsx': 'javascript',
      'rs': 'rust', 'py': 'python', 'go': 'go',
      'java': 'java', 'kt': 'kotlin', 'swift': 'swift',
      'c': 'c', 'h': 'c',
      'cpp': 'cpp', 'cc': 'cpp', 'cxx': 'cpp',
      'cs': 'csharp', 'rb': 'ruby', 'php': 'php',
      'sh': 'bash', 'bash': 'bash', 'zsh': 'bash',
      'json': 'json', 'yml': 'yaml', 'yaml': 'yaml',
      'toml': 'toml', 'md': 'markdown',
      'css': 'css', 'scss': 'scss', 'less': 'less'
    }
    return languageMap[ext || '']
  }
  const HIGHLIGHT_LINE_CAP = 3000

  const highlightCacheRef = useRef<Map<string, string>>(new Map())
  const highlightCode = useCallback((code: string) => {
    if (!code) return ''
    // Disable highlighting when too many changed lines in file to avoid jank
    if (selectedFile) {
      const fd = allFileDiffs.get(selectedFile)
      if ((fd as FileDiffData)?.changedLinesCount && (fd as FileDiffData).changedLinesCount > HIGHLIGHT_LINE_CAP) {
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
  }, [language, allFileDiffs, selectedFile])

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
    
    // Update hover tracking for keyboard shortcuts
    if (selectedFile) {
      setHoveredLineInfo(lineNum, side, selectedFile)
    }
  }, [isDraggingSelection, lineSelection, selectedFile, setHoveredLineInfo])
  
  const handleLineMouseLeave = useCallback(() => {
    clearHoveredLine()
  }, [clearHoveredLine])
  
  const startCommentOnLine = useCallback((lineNum: number, side: 'old' | 'new', _filePath: string) => {
    // Clear any existing selection first
    lineSelection.clearSelection()
    
    // Create a new single-line selection using handleLineClick
    lineSelection.handleLineClick(lineNum, side)
    
    // The useEffect will automatically show the comment form when selection is set
    setShowCommentForm(true)
  }, [lineSelection])
  
  // Enable keyboard shortcuts for hovered lines
  useHoverKeyboardShortcuts(startCommentOnLine, isOpen)

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

  const registerFileBodyHeight = useCallback((filePath: string, height: number) => {
    const normalizedHeight = Math.max(0, Math.round(height))
    const previous = fileBodyHeightsRef.current.get(filePath)
    if (previous !== undefined && Math.abs(previous - normalizedHeight) < 2) {
      return
    }
    fileBodyHeightsRef.current.set(filePath, normalizedHeight)
    setFileHeightsVersion(version => version + 1)
  }, [])

  useEffect(() => {
    const validPaths = new Set(files.map(f => f.path))
    let didDelete = false
    const heights = fileBodyHeightsRef.current
    heights.forEach((_height, path) => {
      if (!validPaths.has(path)) {
        heights.delete(path)
        didDelete = true
      }
    })
    if (didDelete) {
      setFileHeightsVersion(version => version + 1)
    }
  }, [files])

  useEffect(() => {
    const validPaths = new Set(files.map(f => f.path))
    setRenderedFileSet(prev => {
      if (prev.size === 0) {
        return prev
      }
      let mutated = false
      const next = new Set<string>()
      prev.forEach(path => {
        if (validPaths.has(path)) {
          next.add(path)
        } else {
          mutated = true
        }
      })
      if (mutated) {
        recentlyVisibleRef.current = recentlyVisibleRef.current.filter(path => validPaths.has(path))
      }
      return mutated ? next : prev
    })
  }, [files])

  useEffect(() => {
    setExpandedSections(prev => {
      if (prev.size === 0) {
        return prev
      }
      const validPaths = new Set(files.map(f => f.path))
      let mutated = false
      const next = new Map(prev)
      next.forEach((_set, path) => {
        if (!validPaths.has(path)) {
          next.delete(path)
          mutated = true
        }
      })
      return mutated ? next : prev
    })
  }, [files])

  const toggleCollapsed = useCallback((filePath: string, index: number) => {
    setExpandedSections(prev => {
      const next = new Map(prev)
      const current = next.get(filePath)
      const updated = new Set(current ?? [])
      if (updated.has(index)) {
        updated.delete(index)
      } else {
        updated.add(index)
      }
      if (updated.size === 0) {
        next.delete(filePath)
      } else {
        next.set(filePath, updated)
      }
      return next
    })
  }, [])


  useEffect(() => {
    if (!compactDiffs) {
      setExpandedSections(prev => {
        let mutated = false
        const next = new Map(prev)
        allFileDiffs.forEach((fileDiff, path) => {
          if (!('diffResult' in fileDiff)) {
            return
          }
          const previousSet = next.get(path)
          let workingSet = previousSet ?? new Set<number>()
          let localMutated = false
          fileDiff.diffResult.forEach((line, index) => {
            if (line.isCollapsible && !workingSet.has(index)) {
              if (!localMutated) {
                workingSet = new Set(workingSet)
                localMutated = true
              }
              workingSet.add(index)
            }
          })
          if (localMutated) {
            next.set(path, workingSet)
            mutated = true
          } else if (!previousSet && workingSet.size > 0) {
            next.set(path, workingSet)
            mutated = true
          }
        })
        return mutated ? next : prev
      })
    } else {
      setExpandedSections(new Map())
    }
  }, [compactDiffs, allFileDiffs])


  const handleSubmitComment = useCallback(async (text: string) => {
    if (!lineSelection.selection || !selectedFile) return
    
    // Get original file content for comment context
    const [mainText, worktreeText] = await invoke<[string, string]>(TauriCommands.GetFileDiffFromMain, {
      sessionName,
      filePath: selectedFile,
    })
    
    const lines = lineSelection.selection.side === 'old' 
      ? mainText.split('\n')
      : worktreeText.split('\n')
    
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
   }, [lineSelection, selectedFile, addComment, sessionName])

  const { formatReviewForPrompt, getConfirmationMessage } = useReviewComments()

  const handleFinishReview = useCallback(async () => {
    if (!currentReview || currentReview.comments.length === 0) return

    const reviewText = formatReviewForPrompt(currentReview.comments)
    
    try {
      if (selectedKind === 'orchestrator') {
        const terminalId = terminalTop || 'orchestrator-top'
        await invoke(TauriCommands.PasteAndSubmitTerminal, { id: terminalId, data: reviewText })
        await setSelection({ kind: 'orchestrator' })
        setCurrentFocus('claude')
      } else if (sessionName) {
        const terminalId = `session-${sessionName}-top`
        await invoke(TauriCommands.PasteAndSubmitTerminal, { id: terminalId, data: reviewText })
        await setSelection({ kind: 'session', payload: sessionName })
        setFocusForSession(sessionName, 'claude')
        setCurrentFocus('claude')
      } else {
        logger.warn('[UnifiedDiffModal] Finish review had no valid target', { selection })
        return
      }
      
      clearReview()
      onClose()
    } catch (error) {
      logger.error('Failed to send review to terminal:', error)
    }
  }, [currentReview, selectedKind, terminalTop, sessionName, formatReviewForPrompt, clearReview, onClose, setSelection, setFocusForSession, setCurrentFocus, selection])

  // Global keyboard shortcuts for the diff modal (placed after handleFinishReview definition)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return

      if (isShortcutForAction(e, KeyboardShortcutAction.OpenDiffSearch, keyboardShortcutConfig, { platform })) {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        const isEditable = (target as HTMLElement)?.isContentEditable
        if (tag !== 'textarea' && tag !== 'input' && !isEditable) {
          e.preventDefault()
          e.stopPropagation()
          setIsSearchVisible(true)
          return
        }
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.FinishReview, keyboardShortcutConfig, { platform })) {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        const isEditable = (target as HTMLElement)?.isContentEditable
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
        if (isSearchVisible) {
          setIsSearchVisible(false)
        } else if (showCommentForm) {
          setShowCommentForm(false)
          setCommentFormPosition(null)
          lineSelection.clearSelection()
        } else if (isOpen) {
          onClose()
        }
      } else if (isOpen && !showCommentForm && !isSearchVisible) {
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
  }, [isOpen, showCommentForm, isSearchVisible, onClose, lineSelection, selectedFileIndex, files, scrollToFile, handleFinishReview, setIsSearchVisible, setShowCommentForm, setCommentFormPosition, keyboardShortcutConfig, platform])


  const commanderView = isCommanderView()

  if (!isOpen) return null

  return (
    <DiffSessionActions
      isSessionSelection={selection.kind === 'session'}
      isCommanderView={commanderView}
      sessionName={sessionName}
      targetSession={targetSession}
      selectedFile={selectedFile}
      canMarkReviewed={canMarkReviewed}
      onClose={onClose}
      onReloadSessions={reloadSessions}
      onLoadChangedFiles={loadChangedFiles}
    >
      {({ headerActions, fileAction, dialogs }) => (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={onClose}
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="bg-slate-950 rounded-xl shadow-2xl w-[95vw] h-[90vh] flex flex-col overflow-hidden border border-slate-800"
              data-testid="diff-modal"
              data-selected-file={selectedFile || ''}
            >
              {/* Header */}
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
                <div className="flex items-center gap-4">
                  <h2 className="text-lg font-semibold">Git Diff Viewer</h2>
                  {selectedFile && (
                    <div className="text-sm text-slate-400 font-mono">{selectedFile}</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {headerActions}
                  <button
                    onClick={toggleCompactDiffs}
                    className="p-1.5 hover:bg-slate-800 rounded-lg"
                    title={compactDiffs ? "Show full context" : "Collapse unchanged lines"}
                    aria-label={compactDiffs ? "Show full context" : "Collapse unchanged lines"}
                  >
                    {compactDiffs ? (
                      <VscExpandAll className="text-xl" />
                    ) : (
                      <VscCollapseAll className="text-xl" />
                    )}
                  </button>
                  <button
                    onClick={toggleContinuousScroll}
                    className="p-1.5 hover:bg-slate-800 rounded-lg"
                    title={continuousScroll ? "Switch to single file view" : "Switch to continuous scroll"}
                  >
                    {continuousScroll ? (
                      <VscListFlat className="text-xl" />
                    ) : (
                      <VscListSelection className="text-xl" />
                    )}
                  </button>
                  <button
                    onClick={onClose}
                    className="p-1.5 hover:bg-slate-800 rounded-lg"
                  >
                    <VscClose className="text-xl" />
                  </button>
                </div>
              </div>

              <div className="flex flex-1 overflow-hidden">
                {/* File list sidebar */}
                <DiffFileExplorer
                  files={files}
                  selectedFile={selectedFile}
                  visibleFilePath={visibleFilePath}
                  onFileSelect={scrollToFile}
                  getCommentsForFile={getCommentsForFile}
                  currentReview={currentReview}
                  onFinishReview={handleFinishReview}
                  onCancelReview={clearReview}
                  removeComment={removeComment}
                  getConfirmationMessage={getConfirmationMessage}
                />

                {/* Diff viewer */}
                <div className="flex-1 flex flex-col overflow-hidden relative">
                  {fileAction}
                  <DiffViewer
                    files={files}
                    selectedFile={selectedFile}
                    allFileDiffs={allFileDiffs}
                    fileError={fileError}
                    branchInfo={branchInfo}
                    expandedSectionsByFile={expandedSections}
                    isLargeDiffMode={isLargeDiffMode}
                    visibleFileSet={visibleFileSet}
                    renderedFileSet={renderedFileSet}
                    loadingFiles={loadingFiles}
                    observerRef={observerRef}
                    scrollContainerRef={scrollContainerRef as React.RefObject<HTMLDivElement>}
                    fileRefs={fileRefs}
                    fileBodyHeights={fileBodyHeightsRef.current}
                    onFileBodyHeightChange={registerFileBodyHeight}
                    getCommentsForFile={getCommentsForFile}
                    getCommentForLine={getCommentForLine}
                    highlightCode={highlightCode}
                    toggleCollapsed={toggleCollapsed}
                    handleLineMouseDown={handleLineMouseDown}
                    handleLineMouseEnter={handleLineMouseEnter}
                    handleLineMouseLeave={handleLineMouseLeave}
                    handleLineMouseUp={handleLineMouseUp}
                    lineSelection={lineSelection}
                  />

                  {/* Search functionality */}
                  <SearchBox
                    targetRef={scrollContainerRef}
                    isVisible={isSearchVisible}
                    onClose={() => setIsSearchVisible(false)}
                  />

                  {dialogs}

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
                          keyboardShortcutConfig={keyboardShortcutConfig}
                          platform={platform}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </DiffSessionActions>
  )
}

function CommentForm({ onSubmit, onCancel, keyboardShortcutConfig, platform }: {
  onSubmit: (text: string) => void
  onCancel: () => void
  keyboardShortcutConfig: KeyboardShortcutConfig
  platform: Platform
}) {
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
        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm focus:outline-none focus:border-cyan-400 resize-none"
        rows={4}
        autoFocus
        onKeyDown={(e) => {
          const nativeEvent = e.nativeEvent as KeyboardEvent
          if (isShortcutForAction(nativeEvent, KeyboardShortcutAction.SubmitDiffComment, keyboardShortcutConfig, { platform })) {
            handleSubmit()
          } else if (e.key === 'Escape') {
            onCancel()
          }
        }}
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded text-sm"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded text-sm font-medium flex items-center gap-2"
        >
          <VscSend />
          Submit
        </button>
      </div>
    </>
  )
}
