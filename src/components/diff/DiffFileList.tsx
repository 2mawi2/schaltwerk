import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { useSelection } from '../../contexts/SelectionContext'
import { VscFile, VscDiffAdded, VscDiffModified, VscDiffRemoved, VscFileBinary } from 'react-icons/vsc'
// Open button moved to global top bar
import clsx from 'clsx'
import { isBinaryFileByExtension } from '../../utils/binaryDetection'
import { logger } from '../../utils/logger'


interface ChangedFile {
  path: string
  change_type: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'
}

interface DiffFileListProps {
  onFileSelect: (filePath: string) => void
  sessionNameOverride?: string
  isCommander?: boolean
}

export function DiffFileList({ onFileSelect, sessionNameOverride, isCommander }: DiffFileListProps) {
  const { selection } = useSelection()
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [branchInfo, setBranchInfo] = useState<{ 
    currentBranch: string, 
    baseBranch: string,
    baseCommit: string, 
    headCommit: string 
  } | null>(null)
  
  const sessionName = sessionNameOverride ?? (selection.kind === 'session' ? selection.payload : null)
  const lastResultRef = useRef<string>('')
  
  // Use refs to track current values without triggering effect recreations
  const currentPropsRef = useRef({ sessionNameOverride, selection, isCommander })
  currentPropsRef.current = { sessionNameOverride, selection, isCommander }
  
  // Store the load function in a ref so it doesn't change between renders
  const loadChangedFilesRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const cancelledSessionsRef = useRef<Set<string>>(new Set())
  
  loadChangedFilesRef.current = async () => {
    if (isLoading) return // Prevent concurrent loads
    
    setIsLoading(true)
    
    try {
      // CRITICAL: Get current values from ref to avoid stale closures
      const { sessionNameOverride: currentOverride, selection: currentSelection, isCommander: currentIsCommander } = currentPropsRef.current
      const currentSession = currentOverride ?? (currentSelection.kind === 'session' ? currentSelection.payload : null)
      
      // Don't try to load files for cancelled sessions
      if (currentSession && cancelledSessionsRef.current.has(currentSession)) {
        return
      }
      
      // For orchestrator mode (no session), get working changes
      if (currentIsCommander && !currentSession) {
        const [changedFiles, currentBranch] = await Promise.all([
          invoke<ChangedFile[]>('get_orchestrator_working_changes'),
          invoke<string>('get_current_branch_name', { sessionName: null })
        ])
        
        // Check if results actually changed to avoid unnecessary re-renders
        const resultSignature = `orchestrator-${changedFiles.length}-${changedFiles.map(f => `${f.path}:${f.change_type}`).join(',')}-${currentBranch}`
        if (resultSignature !== lastResultRef.current) {
          lastResultRef.current = resultSignature
          setFiles(changedFiles)
          setBranchInfo({
            currentBranch,
            baseBranch: 'Working Directory',
            baseCommit: 'HEAD',
            headCommit: 'Working'
          })
        }
        return
      }
      
      // Regular session mode
      if (!currentSession) {
        // Clear data when no session selected to prevent stale data
        if (lastResultRef.current !== 'no-session') {
          lastResultRef.current = 'no-session'
          setFiles([])
          setBranchInfo(null)
        }
        return
      }
      
      const [changedFiles, currentBranch, baseBranch, [baseCommit, headCommit]] = await Promise.all([
        invoke<ChangedFile[]>('get_changed_files_from_main', { sessionName: currentSession }),
        invoke<string>('get_current_branch_name', { sessionName: currentSession }),
        invoke<string>('get_base_branch_name', { sessionName: currentSession }),
        invoke<[string, string]>('get_commit_comparison_info', { sessionName: currentSession })
      ])
      
      // Check if results actually changed to avoid unnecessary re-renders
      // Include session name in signature to ensure different sessions don't share cached results
      const resultSignature = `session-${currentSession}-${changedFiles.length}-${changedFiles.map(f => `${f.path}:${f.change_type}`).join(',')}-${currentBranch}-${baseBranch}`
      if (resultSignature !== lastResultRef.current) {
        lastResultRef.current = resultSignature
        setFiles(changedFiles)
        setBranchInfo({
          currentBranch,
          baseBranch,
          baseCommit,
          headCommit
        })
      }
    } catch (error: unknown) {
      // Only log error if it's not a "session not found" error (which is expected after cancellation)
      if (!error?.toString()?.includes('not found')) {
        logger.error(`Failed to load changed files:`, error)
      }
      // Clear data on error to prevent showing stale data from previous session
      setFiles([])
      setBranchInfo(null)
    } finally {
      setIsLoading(false)
    }
  }
  
  // Stable function that calls the ref
  const loadChangedFiles = useCallback(async () => {
    await loadChangedFilesRef.current?.()
  }, [])

  // Path resolver used by top bar now; no local button anymore
  
  useEffect(() => {
    // Reset component state immediately when session changes
    const { sessionNameOverride: currentOverride, selection: currentSelection, isCommander: currentIsCommander } = currentPropsRef.current
    const currentSession = currentOverride ?? (currentSelection.kind === 'session' ? currentSelection.payload : null)
    
    if (!currentSession && !currentIsCommander) {
      // Clear files when no session and not orchestrator
      setFiles([])
      setBranchInfo(null)
      lastResultRef.current = 'no-session'
      return
    }

    // CRITICAL: Clear stale data immediately when session changes
    // This prevents showing old session data while new session data loads
    const newSessionKey = currentIsCommander ? 'orchestrator' : currentSession
    const needsDataClear = lastResultRef.current && !lastResultRef.current.includes(newSessionKey || 'no-session')
    if (needsDataClear) {
      setFiles([])
      setBranchInfo(null)
      lastResultRef.current = ''
    }

    // Only load if we don't already have data for this session or if we just cleared stale data
    const hasDataForCurrentSession = lastResultRef.current && lastResultRef.current.includes(newSessionKey || 'no-session')
    if (!hasDataForCurrentSession || needsDataClear) {
      loadChangedFiles()
    }

    let pollInterval: NodeJS.Timeout | null = null
    let eventUnlisten: (() => void) | null = null
    let sessionCancellingUnlisten: (() => void) | null = null
    let isCancelled = false

    // Setup async operations
    const setup = async () => {
      // Listen for session cancelling to stop polling immediately
      if (currentSession) {
        sessionCancellingUnlisten = await listenEvent(SchaltEvent.SessionCancelling, (event) => {
          if (event.session_name === currentSession) {
            logger.info(`Session ${currentSession} is being cancelled, stopping file watcher and polling`)
            isCancelled = true
            // Mark session as cancelled to prevent future loads
            cancelledSessionsRef.current.add(currentSession)
            // Clear data immediately
            setFiles([])
            setBranchInfo(null)
            // Stop polling
            if (pollInterval) {
              clearInterval(pollInterval)
              pollInterval = null
            }
          }
        })
      }
      
      // For orchestrator mode, poll less frequently since working directory changes are less frequent
      if (currentIsCommander && !currentSession) {
        pollInterval = setInterval(() => {
          if (!isCancelled) {
            loadChangedFiles()
          }
        }, 5000) // Poll every 5 seconds for orchestrator
        return
      }
      
      // Try to start file watcher for session mode
      try {
        await invoke('start_file_watcher', { sessionName: currentSession })
        logger.info(`File watcher started for session: ${currentSession}`)
      } catch (error) {
        logger.error('Failed to start file watcher, falling back to polling:', error)
        // Fallback to polling if file watcher fails
        pollInterval = setInterval(() => {
          if (!isCancelled) {
            loadChangedFiles()
          }
        }, 3000)
      }

      // Always set up event listener (even if watcher failed, in case it recovers)
      try {
        eventUnlisten = await listenEvent(SchaltEvent.FileChanges, (event) => {
          // CRITICAL: Only update if this event is for the currently selected session
          const { sessionNameOverride: currentOverride, selection: currentSelection } = currentPropsRef.current
          const currentlySelectedSession = currentOverride ?? (currentSelection.kind === 'session' ? currentSelection.payload : null)
          if (event.session_name === currentlySelectedSession) {
            setFiles(event.changed_files)
            setBranchInfo({
              currentBranch: event.branch_info.current_branch,
              baseBranch: event.branch_info.base_branch,
              baseCommit: event.branch_info.base_commit,
              headCommit: event.branch_info.head_commit
            })
            
            // Update signature to match current session
            lastResultRef.current = `session-${currentlySelectedSession}-${event.changed_files.length}-${event.changed_files.map((f: ChangedFile) => `${f.path}:${f.change_type}`).join(',')}-${event.branch_info.current_branch}-${event.branch_info.base_branch}`
            
            // If we receive events, we can stop polling
            if (pollInterval) {
              clearInterval(pollInterval)
              pollInterval = null
            }
          }
        })
      } catch (error) {
        logger.error('Failed to set up event listener:', error)
      }
    }
    
    setup()
    
    return () => {
      // Stop file watcher
      if (currentSession) {
        invoke('stop_file_watcher', { sessionName: currentSession }).catch(err => logger.error("Error:", err))
      }
      // Clean up event listeners
      if (eventUnlisten) {
        eventUnlisten()
      }
      if (sessionCancellingUnlisten) {
        sessionCancellingUnlisten()
      }
      // Clean up polling if active
      if (pollInterval) {
        clearInterval(pollInterval)
      }
    }
  }, [sessionNameOverride, selection, isCommander, loadChangedFiles])
  
  const handleFileClick = (file: ChangedFile) => {
    setSelectedFile(file.path)
    onFileSelect(file.path)
  }
  
  const getFileIcon = (changeType: string, filePath: string) => {
    if (isBinaryFileByExtension(filePath)) {
      return <VscFileBinary className="text-slate-400" />
    }
    
    switch (changeType) {
      case 'added': return <VscDiffAdded className="text-green-500" />
      case 'modified': return <VscDiffModified className="text-yellow-500" />
      case 'deleted': return <VscDiffRemoved className="text-red-500" />
      default: return <VscFile className="text-blue-500" />
    }
  }
  
  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="px-3 py-2 border-b border-slate-800 relative">
        <div className="flex items-center justify-between pr-12">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {isCommander && !sessionName 
                ? 'Uncommitted Changes' 
                : `Changes from ${branchInfo?.baseBranch || 'base'}`}
            </span>
            {branchInfo && !isCommander && (
              <span className="text-xs text-slate-500">
                ({branchInfo.currentBranch} → {branchInfo.baseBranch})
              </span>
            )}
            {branchInfo && isCommander && (
              <span className="text-xs text-slate-500">
                (on {branchInfo.currentBranch})
              </span>
            )}
          </div>
          {branchInfo && files.length > 0 && (
            <div className="text-xs text-slate-500">
              {files.length} files changed
            </div>
          )}
        </div>
      </div>
      
      {sessionName === null && !isCommander ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-slate-500">
            <div className="text-sm">No session selected</div>
            <div className="text-xs mt-1">Select a session to view changes</div>
          </div>
        </div>
      ) : files.length > 0 ? (
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            {files.map(file => (
              <div
                key={file.path}
                className={clsx(
                  "flex items-center gap-2 px-2 py-2 rounded cursor-pointer",
                  "hover:bg-slate-800/50 transition-colors",
                  selectedFile === file.path && "bg-slate-800/30"
                )}
                onClick={() => handleFileClick(file)}
              >
                {getFileIcon(file.change_type, file.path)}
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate font-medium">
                    {file.path.split('/').pop()}
                  </div>
                  {file.path.includes('/') && (
                    <div className="text-xs text-slate-500 truncate">
                      {file.path.substring(0, file.path.lastIndexOf('/'))}
                    </div>
                  )}
                </div>
                <div className="text-xs text-slate-400 uppercase">
                  {file.change_type === 'modified' ? 'M' : 
                   file.change_type === 'added' ? 'A' :
                   file.change_type === 'deleted' ? 'D' : 
                   file.change_type[0].toUpperCase()}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-500">
          <div className="text-center">
            <VscFile className="mx-auto mb-2 text-4xl opacity-50" />
            <div className="mb-1">
              {isCommander && !sessionName 
                ? 'No uncommitted changes' 
                : `No changes from ${branchInfo?.baseBranch || 'base'}`}
            </div>
            <div className="text-xs">
              {isCommander && !sessionName 
                ? 'Your working directory is clean'
                : branchInfo?.currentBranch === branchInfo?.baseBranch 
                  ? `You are on the ${branchInfo?.baseBranch} branch` 
                  : `Your branch is up to date with ${branchInfo?.baseBranch || 'base'}`
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
