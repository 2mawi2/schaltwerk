import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSelection } from '../../contexts/SelectionContext'
import { VscFile, VscDiffAdded, VscDiffModified, VscDiffRemoved, VscFileBinary } from 'react-icons/vsc'
// Open button moved to global top bar
import clsx from 'clsx'
import { isBinaryFileByExtension } from '../../utils/binaryDetection'

interface ChangedFile {
  path: string
  change_type: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'unknown'
}

interface FileChangeEvent {
  session_name: string
  changed_files: ChangedFile[]
  change_summary: {
    files_changed: number
    lines_added: number
    lines_removed: number
    has_staged: boolean
    has_unstaged: boolean
  }
  branch_info: {
    current_branch: string
    base_branch: string
    base_commit: string
    head_commit: string
  }
  timestamp: number
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
  
  const loadChangedFiles = useCallback(async () => {
    if (isLoading) return // Prevent concurrent loads
    
    setIsLoading(true)
    
    try {
      // Use the current sessionName value from closure
      const currentSession = sessionNameOverride ?? (selection.kind === 'session' ? selection.payload : null)
      
      // For commander mode (no session), get working changes
      if (isCommander && !currentSession) {
        const [changedFiles, currentBranch] = await Promise.all([
          invoke<ChangedFile[]>('get_orchestrator_working_changes'),
          invoke<string>('get_current_branch_name', { sessionName: null })
        ])
        
        // Check if results actually changed to avoid unnecessary re-renders
        const resultSignature = `${changedFiles.length}-${changedFiles.map(f => `${f.path}:${f.change_type}`).join(',')}-${currentBranch}`
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
      if (!currentSession) return
      
      const [changedFiles, currentBranch, baseBranch, [baseCommit, headCommit]] = await Promise.all([
        invoke<ChangedFile[]>('get_changed_files_from_main', { sessionName: currentSession }),
        invoke<string>('get_current_branch_name', { sessionName: currentSession }),
        invoke<string>('get_base_branch_name', { sessionName: currentSession }),
        invoke<[string, string]>('get_commit_comparison_info', { sessionName: currentSession })
      ])
      
      // Check if results actually changed to avoid unnecessary re-renders
      const resultSignature = `${changedFiles.length}-${changedFiles.map(f => `${f.path}:${f.change_type}`).join(',')}-${currentBranch}-${baseBranch}`
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
    } catch (error) {
      console.error('Failed to load changed files:', error)
    } finally {
      setIsLoading(false)
    }
  }, [sessionNameOverride, selection, isCommander, isLoading])

  // Path resolver used by top bar now; no local button anymore
  
  useEffect(() => {
    if (!sessionName && !isCommander) {
      // Clear files when no session and not commander
      setFiles([])
      setBranchInfo(null)
      return
    }

    // Initial load
    loadChangedFiles()

    let pollInterval: NodeJS.Timeout | null = null
    let eventUnlisten: (() => void) | null = null

    // Setup async operations
    const setup = async () => {
      // For commander mode, poll less frequently since working directory changes are less frequent
      if (isCommander && !sessionName) {
        pollInterval = setInterval(loadChangedFiles, 5000) // Poll every 5 seconds for commander
        return
      }
      
      // Try to start file watcher for session mode
      try {
        await invoke('start_file_watcher', { sessionName })
        console.log(`File watcher started for session: ${sessionName}`)
      } catch (error) {
        console.error('Failed to start file watcher, falling back to polling:', error)
        // Fallback to polling if file watcher fails
        pollInterval = setInterval(loadChangedFiles, 3000)
      }

      // Always set up event listener (even if watcher failed, in case it recovers)
      try {
        eventUnlisten = await listen<FileChangeEvent>('schaltwerk:file-changes', (event) => {
          if (event.payload.session_name === sessionName) {
            setFiles(event.payload.changed_files)
            setBranchInfo({
              currentBranch: event.payload.branch_info.current_branch,
              baseBranch: event.payload.branch_info.base_branch,
              baseCommit: event.payload.branch_info.base_commit,
              headCommit: event.payload.branch_info.head_commit
            })
            
            // If we receive events, we can stop polling
            if (pollInterval) {
              clearInterval(pollInterval)
              pollInterval = null
            }
          }
        })
      } catch (error) {
        console.error('Failed to set up event listener:', error)
      }
    }
    
    setup()
    
    return () => {
      // Stop file watcher
      if (sessionName) {
        invoke('stop_file_watcher', { sessionName }).catch(console.error)
      }
      // Clean up event listener
      if (eventUnlisten) {
        eventUnlisten()
      }
      // Clean up polling if active
      if (pollInterval) {
        clearInterval(pollInterval)
      }
    }
  }, [sessionName, isCommander])  // Remove loadChangedFiles from dependencies!
  
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
