import { useEffect, useState, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface Selection {
    kind: 'session' | 'orchestrator'
    payload?: string
    color?: 'blue' | 'green' | 'violet' | 'amber' | 'gray'
    worktreePath?: string
}

interface WorkspaceTerminals {
    top: string
    bottom: string
    right: string
}

interface SessionWorkspace {
    selection: Selection
    terminals: WorkspaceTerminals
    ensureWorkspaceReady: () => Promise<void>
}

/**
 * Unified hook for managing all session terminals as a workspace.
 * Manages the complete set of terminals (top, bottom, right) for each session.
 */
export function useSessionWorkspace(): SessionWorkspace {
    const [selection, setSelection] = useState<Selection>({ kind: 'orchestrator' })
    const [mainRepoPath, setMainRepoPath] = useState<string>('.')
    const [currentTerminals, setCurrentTerminals] = useState<WorkspaceTerminals>({
        top: 'orchestrator-top',
        bottom: 'orchestrator-bottom',
        right: 'orchestrator-right'
    })
    // Prevent out-of-order async updates when switching selection quickly
    const selectionSeq = useRef<number>(0)
    
    // Track which terminals have been created to avoid duplicate creation
    const createdTerminals = useRef(new Set<string>())
    const creatingTerminals = useRef(new Set<string>())
    
    // Generate terminal IDs for a given selection
    const getTerminalIds = useCallback((sel: Selection): WorkspaceTerminals => {
        const prefix = sel.kind === 'orchestrator' ? 'orchestrator' : `session-${sel.payload}`
        return {
            top: `${prefix}-top`,
            bottom: `${prefix}-bottom`,
            right: `${prefix}-right`
        }
    }, [])
    
    // Create a single terminal if it doesn't exist
    const createTerminal = useCallback(async (id: string, cwd: string) => {
        // Fast-path: already created
        if (createdTerminals.current.has(id)) return
        // Avoid duplicate in-flight creations
        if (creatingTerminals.current.has(id)) return
        creatingTerminals.current.add(id)
        try {
            const exists = await invoke<boolean>('terminal_exists', { id })
            if (!exists) {
                console.log(`[SessionWorkspace] Creating terminal: ${id} in ${cwd}`)
                await invoke('create_terminal', { id, cwd })
            }
            // Mark as created regardless to prevent redundant checks
            createdTerminals.current.add(id)
        } catch (err) {
            console.error(`Failed to create terminal ${id}:`, err)
            throw err
        } finally {
            creatingTerminals.current.delete(id)
        }
    }, [])
    
    // Ensure all terminals for a workspace exist
    const ensureWorkspaceReady = useCallback(async (ids: WorkspaceTerminals, cwd: string) => {
        console.log(`[SessionWorkspace] Ensuring workspace ready with terminals:`, ids, `in ${cwd}`)
        
        // Create all terminals in parallel
        await Promise.all([
            createTerminal(ids.top, cwd),
            createTerminal(ids.bottom, cwd),
            createTerminal(ids.right, cwd)
        ])
    }, [createTerminal])
    
    // Initialize main repo path and orchestrator workspace on mount
    useEffect(() => {
        invoke<string>('get_current_directory').then(path => {
            console.log(`[SessionWorkspace] Main repo path: ${path}`)
            setMainRepoPath(path)
            
            // Initialize orchestrator workspace
            const orchestratorIds = getTerminalIds({ kind: 'orchestrator' })
            ensureWorkspaceReady(orchestratorIds, path).then(async () => {
                console.log('[SessionWorkspace] Orchestrator workspace ready')
            })
        }).catch(err => {
            console.error('Failed to get current directory:', err)
            // Fall back to current directory
            const orchestratorIds = getTerminalIds({ kind: 'orchestrator' })
            ensureWorkspaceReady(orchestratorIds, '.')
        })
    }, [getTerminalIds, ensureWorkspaceReady])
    
    // Listen for selection changes
    useEffect(() => {
        const handler = async (e: Event) => {
            const detail = (e as CustomEvent).detail as Selection
            console.log('[SessionWorkspace] Selection event received:', {
                kind: detail.kind,
                payload: detail.payload,
                worktreePath: detail.worktreePath
            })
            // Increment sequence to invalidate in-flight operations from prior selections
            const mySeq = ++selectionSeq.current
            setSelection(detail)
            
            // Get the terminal IDs for the new selection
            const newIds = getTerminalIds(detail)
            console.log('[SessionWorkspace] Generated terminal IDs:', newIds)
            
            // Determine the working directory
            const workingDir = detail.kind === 'orchestrator' 
                ? mainRepoPath 
                : (detail.worktreePath || mainRepoPath)
            console.log('[SessionWorkspace] Working directory:', workingDir)
            
            // Ensure the new workspace exists before switching
            console.log('[SessionWorkspace] Ensuring workspace ready...')
            await ensureWorkspaceReady(newIds, workingDir)
            console.log('[SessionWorkspace] Workspace ready')
            
            // Abort if a newer selection happened while we were preparing this one
            if (mySeq !== selectionSeq.current) {
                console.log('[SessionWorkspace] Newer selection detected; skipping state apply for stale selection')
                return
            }

            // Update current terminals (UI shows correct terminals)
            setCurrentTerminals(newIds)
            console.log('[SessionWorkspace] Current terminals updated to:', newIds)
            
            // Start/resume Claude once the terminal exists and after switching
            const targetTop = newIds.top
            try {
                const exists = await invoke<boolean>('terminal_exists', { id: targetTop })
                if (!exists) {
                    console.warn('[SessionWorkspace] Target terminal not found after ensure; skipping start', { targetTop })
                } else {
                    if (detail.kind === 'orchestrator') {
                        console.log('[SessionWorkspace] Starting Claude in orchestrator (centralized)')
                        await invoke('para_core_start_claude_orchestrator')
                    } else if (detail.kind === 'session' && detail.payload) {
                        console.log('[SessionWorkspace] Starting Claude in session (centralized)', { sessionName: detail.payload, targetTop })
                        await invoke('para_core_start_claude', { sessionName: detail.payload })
                    }
                }
            } catch (err) {
                console.error('[SessionWorkspace] Failed to start/resume Claude (centralized):', err)
                
                // Check if it's a permission error and dispatch event
                const errorMessage = String(err);
                if (errorMessage.includes('Permission required for folder:')) {
                    window.dispatchEvent(new CustomEvent('schaltwerk:permission-error', {
                        detail: { error: errorMessage }
                    }));
                }
            }
            
            // Update the center unified ring color to match selection
            const el = document.getElementById('work-ring')
            if (el) {
                const colorMap: Record<string, string> = {
                    blue: 'rgba(59,130,246,0.45)',
                    green: 'rgba(34,197,94,0.45)',
                    violet: 'rgba(139,92,246,0.45)',
                    amber: 'rgba(245,158,11,0.45)',
                    gray: 'rgba(107,114,128,0.45)'
                }
                const color = detail.kind === 'orchestrator' 
                    ? colorMap.blue 
                    : colorMap[detail.color || 'green']
                el.style.boxShadow = `0 0 0 2px ${color}`
            }
        }
        
        window.addEventListener('para-ui:selection', handler as any)
        return () => window.removeEventListener('para-ui:selection', handler as any)
    }, [getTerminalIds, ensureWorkspaceReady, mainRepoPath])
    
    return {
        selection,
        terminals: currentTerminals,
        ensureWorkspaceReady: async () => {
            const workingDir = selection.kind === 'orchestrator'
                ? mainRepoPath
                : (selection.worktreePath || mainRepoPath)
            await ensureWorkspaceReady(currentTerminals, workingDir)
        }
    }
}