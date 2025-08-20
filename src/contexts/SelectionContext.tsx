import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useProject } from './ProjectContext'

export interface Selection {
    kind: 'session' | 'orchestrator'
    payload?: string
    worktreePath?: string
}

interface TerminalSet {
    top: string
    bottomBase: string
    workingDirectory: string
}

interface SelectionContextType {
    selection: Selection
    terminals: TerminalSet
    setSelection: (selection: Selection, forceRecreate?: boolean, isIntentional?: boolean) => Promise<void>
    clearTerminalTracking: (terminalIds: string[]) => Promise<void>
    isReady: boolean
    isDraft: boolean
}

const SelectionContext = createContext<SelectionContextType | null>(null)

export function SelectionProvider({ children }: { children: React.ReactNode }) {
    const { projectPath } = useProject()
    const [selection, setSelectionState] = useState<Selection>({ kind: 'orchestrator' })
    const [terminals, setTerminals] = useState<TerminalSet>({
        top: 'orchestrator-default-top',
        bottomBase: 'orchestrator-default-bottom',
        workingDirectory: ''
    })
    // Start as not ready, will become ready once we have initialized with a project
    const [isReady, setIsReady] = useState(false)
    const [isDraft, setIsDraft] = useState(false)
    const previousProjectPath = useRef<string | null>(null)
    const hasInitialized = useRef(false)
    
    // Track which terminals we've created to avoid duplicates
    const terminalsCreated = useRef(new Set<string>())
    const creationLock = useRef(new Map<string, Promise<void>>())
    
    // Selection memory per project (in-memory only, persists during app runtime)
    const selectionMemory = useRef(new Map<string, Selection>())
    const isRestoringRef = useRef(false)
    
    // Get terminal IDs for a selection
    const getTerminalIds = useCallback((sel: Selection): TerminalSet => {
        let workingDir = projectPath || ''
        
        if (sel.kind === 'orchestrator') {
            // Make orchestrator terminals project-specific by using project path hash
            // Use a simple hash of the full path to ensure uniqueness
            let projectId = 'default'
            if (projectPath) {
                // Get just the last directory name and combine with a hash for uniqueness
                const dirName = projectPath.split(/[/\\]/).pop() || 'unknown'
                // Simple hash: sum of char codes
                let hash = 0
                for (let i = 0; i < projectPath.length; i++) {
                    hash = ((hash << 5) - hash) + projectPath.charCodeAt(i)
                    hash = hash & hash // Convert to 32bit integer
                }
                projectId = `${dirName}-${Math.abs(hash).toString(16).slice(0, 6)}`
            }
            const base = `orchestrator-${projectId}`
            return {
                top: `${base}-top`,
                bottomBase: `${base}-bottom`,
                workingDirectory: workingDir
            }
        } else {
            const base = `session-${sel.payload}`
            const sessionWorkingDir = sel.worktreePath || workingDir
            return {
                top: `${base}-top`,
                bottomBase: `${base}-bottom`,
                workingDirectory: sessionWorkingDir
            }
        }
    }, [projectPath])
    
    // Create a single terminal with deduplication
    const createTerminal = useCallback(async (id: string, cwd: string) => {
        // If already created, skip
        if (terminalsCreated.current.has(id)) {
            return
        }
        
        // If already creating, wait for that to finish
        if (creationLock.current.has(id)) {
            await creationLock.current.get(id)
            return
        }
        
        // Create promise for this creation
        const createPromise = (async () => {
            try {
                const exists = await invoke<boolean>('terminal_exists', { id })
                if (!exists) {
                    await invoke('create_terminal', { id, cwd })
                }
                terminalsCreated.current.add(id)
            } catch (error) {
                console.error(`Failed to create terminal ${id}:`, error)
                throw error
            }
        })()
        
        // Store promise so others can wait
        creationLock.current.set(id, createPromise)
        
        try {
            await createPromise
        } finally {
            creationLock.current.delete(id)
        }
    }, [])
    
    // Ensure terminals exist for a selection
    const ensureTerminals = useCallback(async (sel: Selection): Promise<TerminalSet> => {
        const ids = getTerminalIds(sel)

        // Orchestrator always has terminals and is never a draft
        if (sel.kind === 'orchestrator') {
            setIsDraft(false)
            const cwd = projectPath || await invoke<string>('get_current_directory')
            await createTerminal(ids.top, cwd)
            return ids
        }

        // Sessions: determine if draft and working directory
        try {
            const sessionData = await invoke<any>('para_core_get_session', { name: sel.payload })
            const state: string | undefined = sessionData?.state || sessionData?.session_state
            const worktreePath: string | undefined = sel.worktreePath || sessionData?.worktree_path
            const isDraftSession = state === 'draft'
            setIsDraft(!!isDraftSession)

            if (isDraftSession) {
                // Do not create terminals for drafts
                return ids
            }

            const cwd = worktreePath || await invoke<string>('get_current_directory')
            await createTerminal(ids.top, cwd)
            return ids
        } catch (e) {
            console.error('[SelectionContext] Failed to inspect session state; creating terminals with fallback cwd', e)
            setIsDraft(false)
            const cwd = await invoke<string>('get_current_directory')
            await createTerminal(ids.top, cwd)
            return ids
        }
    }, [getTerminalIds, createTerminal, projectPath])
    
    // Helper to get default selection for current project
    const getDefaultSelection = useCallback(async (): Promise<Selection> => {
        // Try to load saved selection for this project
        if (projectPath) {
            try {
                const stored = localStorage.getItem('schaltwerk-selections')
                if (stored) {
                    const selections = JSON.parse(stored)
                    const savedSelection = selections[projectPath]
                    if (savedSelection) {
                        console.log('[SelectionContext] Restored saved selection for project:', projectPath, savedSelection)
                        return savedSelection
                    }
                }
            } catch (error) {
                console.error('[SelectionContext] Failed to load saved selection:', error)
            }
        }
        
        // Default to orchestrator if no saved selection
        return { kind: 'orchestrator' }
    }, [projectPath])
    
    // Validate and restore a remembered selection
    const validateAndRestoreSelection = useCallback(async (remembered: Selection): Promise<Selection> => {
        // If orchestrator, it's always valid
        if (remembered.kind === 'orchestrator') {
            return remembered
        }
        
        // For sessions, check if it still exists
        if (remembered.kind === 'session' && remembered.payload) {
            try {
                const sessionData = await invoke<any>('para_core_get_session', { name: remembered.payload })
                // Session exists - we could check state here if needed
                // const state = sessionData?.state || sessionData?.session_state
                
                // Update worktreePath if it has changed
                const worktreePath = sessionData?.worktree_path || remembered.worktreePath
                
                // Return the validated selection with updated worktree path
                return {
                    kind: 'session',
                    payload: remembered.payload,
                    worktreePath
                }
            } catch (error) {
                console.log(`[SelectionContext] Session ${remembered.payload} no longer exists, falling back to orchestrator`)
                // Session doesn't exist anymore, fallback to orchestrator
                return { kind: 'orchestrator' }
            }
        }
        
        // Default fallback
        return { kind: 'orchestrator' }
    }, [])
    
    // Clear terminal tracking and close terminals to prevent orphaned processes
    // Used when: 1) Switching projects (orchestrator IDs change), 2) Restarting orchestrator with new model
    const clearTerminalTracking = useCallback(async (terminalIds: string[]) => {
        for (const id of terminalIds) {
            terminalsCreated.current.delete(id)
            creationLock.current.delete(id)
            // Close the actual terminal process to avoid orphaned processes
            try {
                const exists = await invoke<boolean>('terminal_exists', { id })
                if (exists) {
                    await invoke('close_terminal', { id })
                }
            } catch (e) {
                console.warn(`[SelectionContext] Failed to close terminal ${id}:`, e)
            }
        }
    }, [])
    
    // Set selection atomically
    const setSelection = useCallback(async (newSelection: Selection, forceRecreate = false, isIntentional = false) => {
        // Get the new terminal IDs to check if they're changing
        const newTerminalIds = getTerminalIds(newSelection)
        
        // Check if we're actually changing selection or terminals (but allow initial setup or force recreate)
        if (!forceRecreate && isReady && 
            selection.kind === newSelection.kind && 
            selection.payload === newSelection.payload &&
            terminals.top === newTerminalIds.top) {
            return
        }
        
        // For already created terminals, switch immediately without showing "Initializing..."
        const terminalAlreadyExists = terminalsCreated.current.has(newTerminalIds.top)
        
        // Only mark as not ready if we actually need to create new terminals
        if (!terminalAlreadyExists) {
            setIsReady(false)
        }
        
        try {
            // If forcing recreate, clear terminal tracking and close old terminals first
            if (forceRecreate) {
                const ids = getTerminalIds(newSelection)
                await clearTerminalTracking([ids.top])
            }
            
            // If terminal already exists, update state immediately for instant switch
            if (terminalAlreadyExists && !forceRecreate) {
                // Update selection and terminals immediately
                setSelectionState(newSelection)
                setTerminals(newTerminalIds)
                
                // Save to memory if this is an intentional change and not during restoration
                if (isIntentional && !isRestoringRef.current && projectPath) {
                    selectionMemory.current.set(projectPath, newSelection)
                }
                
                // Ensure ready state
                if (!isReady) {
                    setIsReady(true)
                }
                return
            }
            
            // For new terminals, create them first
            const terminalIds = await ensureTerminals(newSelection)
            
            // Now atomically update both selection and terminals
            setSelectionState(newSelection)
            setTerminals(terminalIds)
            
            // Save to memory if this is an intentional change and not during restoration
            if (isIntentional && !isRestoringRef.current && projectPath) {
                selectionMemory.current.set(projectPath, newSelection)
            }
            
            // Mark as ready
            setIsReady(true)

        } catch (error) {
            console.error('[SelectionContext] Failed to set selection:', error)
            // Stay on current selection if we fail
            setIsReady(true)
        }
    }, [ensureTerminals, getTerminalIds, clearTerminalTracking, isReady, selection, terminals, projectPath])

    // React to backend session refreshes (e.g., draft -> running)
    useEffect(() => {
        let unlisten: (() => void) | null = null
        const attach = async () => {
            try {
                const { listen } = await import('@tauri-apps/api/event')
                unlisten = await listen('schaltwerk:sessions-refreshed', async () => {
                    if (selection.kind !== 'session' || !selection.payload) return
                    try {
                        const sessionData = await invoke<any>('para_core_get_session', { name: selection.payload })
                        const state: string | undefined = sessionData?.state || sessionData?.session_state
                        const nowDraft = state === 'draft'
                        setIsDraft(!!nowDraft)
                        if (!nowDraft) {
                            // Session became running - ensure terminals exist now
                            try { await ensureTerminals(selection) } catch {}
                            // Update terminals state to pick up any new ids (same ids, but ensures UI triggers)
                            setTerminals(getTerminalIds(selection))
                        }
                    } catch (e) {
                        console.warn('[SelectionContext] Failed to refresh current session state after event', e)
                    }
                })
            } catch (e) {
                console.warn('[SelectionContext] Failed to attach sessions-refreshed listener', e)
            }
        }
        attach()
        return () => { try { if (unlisten) unlisten() } catch {} }
    }, [selection, ensureTerminals, getTerminalIds])
    
    // Initialize on mount and when project path changes
    useEffect(() => {
        const initialize = async () => {
            console.log('[SelectionContext] Initialize effect triggered, projectPath:', projectPath)
            
            // Wait for projectPath to be set before initializing
            if (!projectPath) {
                console.log('[SelectionContext] No projectPath, skipping initialization')
                return
            }
            
            // Skip if already initialized with same project path
            if (hasInitialized.current && previousProjectPath.current === projectPath) {
                console.log('[SelectionContext] Already initialized with same project path, skipping')
                return
            }
            
            // Check if we're switching projects
            const projectChanged = hasInitialized.current && 
                                  previousProjectPath.current !== null && 
                                  previousProjectPath.current !== projectPath
            
            console.log('[SelectionContext] Project changed?', projectChanged, 'Previous:', previousProjectPath.current, 'New:', projectPath)
            
            // Set initialized flag and update previous path
            hasInitialized.current = true
            
            // If switching projects, save current selection for the old project before switching
            if (projectChanged && previousProjectPath.current && !isRestoringRef.current) {
                selectionMemory.current.set(previousProjectPath.current, selection)
            }
            
            previousProjectPath.current = projectPath
            
            // Determine target selection
            let targetSelection: Selection
            
            if (projectChanged) {
                // Check if we have a remembered selection for this project
                const remembered = selectionMemory.current.get(projectPath)
                if (remembered) {
                    // Mark that we're restoring to prevent saving this automatic change
                    isRestoringRef.current = true
                    try {
                        // Validate the remembered selection (session might be deleted)
                        targetSelection = await validateAndRestoreSelection(remembered)
                    } finally {
                        isRestoringRef.current = false
                    }
                } else {
                    // No memory for this project, default to orchestrator
                    targetSelection = { kind: 'orchestrator' }
                }
            } else {
                // First initialization, use default
                targetSelection = await getDefaultSelection()
            }
            
            console.log('[SelectionContext] Setting selection to:', targetSelection)
            
            // Set the selection - the orchestrator terminals are already project-specific via the ID hash
            // No need to force recreate, just switch to the correct project's orchestrator
            await setSelection(targetSelection, false, false) // Not intentional - this is automatic restoration
        }
        
        // Only run if not currently initializing
        initialize().catch(error => {
            console.error('[SelectionContext] Failed to initialize:', error)
            // Still mark as ready even on error so UI doesn't hang
            setIsReady(true)
        })
    }, [projectPath, setSelection, getTerminalIds, validateAndRestoreSelection, getDefaultSelection, selection]) // Re-run when projectPath changes
    
    // Listen for selection events from backend (e.g., when MCP creates/updates drafts)
    useEffect(() => {
        let unlisten: (() => void) | undefined
        
        const setupSelectionListener = async () => {
            try {
                unlisten = await listen<Selection>('schaltwerk:selection', async (event) => {
                    console.log('Received selection event from backend:', event.payload)
                    // Set the selection to the requested session/draft - this is intentional (backend requested)
                    await setSelection(event.payload, false, true)
                })
            } catch (e) {
                console.error('[SelectionContext] Failed to attach selection listener', e)
            }
        }
        
        setupSelectionListener()
        
        return () => {
            if (unlisten) {
                unlisten()
            }
        }
    }, [setSelection])
    
    // Listen for session removal to clear from memory
    useEffect(() => {
        let unlisten: (() => void) | undefined
        
        const setupRemovalListener = async () => {
            try {
                unlisten = await listen<{ sessionName: string }>('schaltwerk:session-removed', (event) => {
                    const removedSessionName = event.payload.sessionName
                    
                    // Clear from memory for all projects if this session was selected
                    selectionMemory.current.forEach((selection, projectPath) => {
                        if (selection.kind === 'session' && selection.payload === removedSessionName) {
                            selectionMemory.current.delete(projectPath)
                        }
                    })
                })
            } catch (e) {
                console.error('[SelectionContext] Failed to attach session-removed listener', e)
            }
        }
        
        setupRemovalListener()
        
        return () => {
            if (unlisten) {
                unlisten()
            }
        }
    }, [])
    
    return (
        <SelectionContext.Provider value={{ 
            selection, 
            terminals,
            setSelection,
            clearTerminalTracking,
            isReady,
            isDraft
        }}>
            {children}
        </SelectionContext.Provider>
    )
}

export function useSelection() {
    const context = useContext(SelectionContext)
    if (!context) {
        throw new Error('useSelection must be used within SelectionProvider')
    }
    return context
}