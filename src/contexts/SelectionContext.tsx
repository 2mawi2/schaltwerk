import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useProject } from './ProjectContext'
import { useFontSize } from './FontSizeContext'
import { useSessions } from './SessionsContext'

export interface Selection {
    kind: 'session' | 'orchestrator'
    payload?: string
    worktreePath?: string
    sessionState?: 'spec' | 'running' | 'reviewed'  // Pass from Sidebar to avoid async fetch
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
    isPlan: boolean
}

const SelectionContext = createContext<SelectionContextType | null>(null)

export function SelectionProvider({ children }: { children: React.ReactNode }) {
    const { projectPath } = useProject()
    const { terminalFontSize } = useFontSize()
    const { setCurrentSelection } = useSessions()
    const [selection, setSelectionState] = useState<Selection>({ kind: 'orchestrator' })
    const [terminals, setTerminals] = useState<TerminalSet>({
        top: 'orchestrator-default-top',
        bottomBase: 'orchestrator-default-bottom',
        workingDirectory: ''
    })
    // Start as not ready, will become ready once we have initialized with a project
    const [isReady, setIsReady] = useState(false)
    const [isPlan, setIsPlan] = useState(false)
    const previousProjectPath = useRef<string | null>(null)
    const hasInitialized = useRef(false)
    
    // Track which terminals we've created to avoid duplicates
    const terminalsCreated = useRef(new Set<string>())
    const creationLock = useRef(new Map<string, Promise<void>>())
    
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
                // Sanitize directory name: replace spaces and special chars with underscores
                const sanitizedDirName = dirName.replace(/[^a-zA-Z0-9_-]/g, '_')
                // Simple hash: sum of char codes
                let hash = 0
                for (let i = 0; i < projectPath.length; i++) {
                    hash = ((hash << 5) - hash) + projectPath.charCodeAt(i)
                    hash = hash & hash // Convert to 32bit integer
                }
                projectId = `${sanitizedDirName}-${Math.abs(hash).toString(16).slice(0, 6)}`
            }
            const base = `orchestrator-${projectId}`
            return {
                top: `${base}-top`,
                bottomBase: `${base}-bottom`,
                workingDirectory: workingDir
            }
        } else {
            // Sanitize session name: replace spaces and special chars with underscores
            const sanitizedSessionName = (sel.payload || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
            const base = `session-${sanitizedSessionName}`
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
                    // Calculate terminal dimensions based on available space
                    // This provides better initial sizing for TUI applications
                    const calculateTerminalSize = () => {
                        // Get viewport dimensions
                        const viewportWidth = window.innerWidth
                        const viewportHeight = window.innerHeight
                        
                        // Account for UI elements (sidebar, tabs, padding)
                        const sidebarWidth = 256  // Sidebar width
                        const rightPanelWidth = 384 // Right panel width  
                        const padding = 32 // Total horizontal padding
                        const headerHeight = 48 // Header/tabs height
                        const bottomPadding = 32 // Bottom padding
                        
                        // Calculate available terminal space
                        const availableWidth = viewportWidth - sidebarWidth - rightPanelWidth - padding
                        const availableHeight = viewportHeight - headerHeight - bottomPadding
                        
                        // Calculate cols/rows based on actual font metrics
                        // Common monospace fonts have width ~0.6 of height
                        const charWidth = Math.ceil(terminalFontSize * 0.6)
                        const charHeight = Math.ceil(terminalFontSize * 1.5) // Line height is typically 1.5x font size
                        
                        const cols = Math.max(80, Math.floor(availableWidth / charWidth))
                        const rows = Math.max(24, Math.floor(availableHeight / charHeight))
                        
                        return { cols, rows }
                    }
                    
                    const { cols, rows } = calculateTerminalSize()
                    
                    // Use the new command with size if dimensions are reasonable
                    if (cols > 80 && rows > 24) {
                        await invoke('create_terminal_with_size', { id, cwd, cols, rows })
                    } else {
                        // Fallback to default size for small windows
                        await invoke('create_terminal', { id, cwd })
                    }
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
    }, [terminalFontSize])
    
    // Ensure terminals exist for a selection
    const ensureTerminals = useCallback(async (sel: Selection): Promise<TerminalSet> => {
        const ids = getTerminalIds(sel)

        // Orchestrator always has terminals and is never a spec
        if (sel.kind === 'orchestrator') {
            setIsPlan(false)
            const cwd = projectPath || await invoke<string>('get_current_directory')
            await createTerminal(ids.top, cwd)
            return ids
        }

        // Sessions: Use passed sessionState if available to avoid async fetch
        if (sel.sessionState) {
            const isPlanSession = sel.sessionState === 'spec'
            setIsPlan(isPlanSession)
            
            if (isPlanSession) {
                // Do not create terminals for plans
                return ids
            }
            
            // Create terminals for non-plan sessions
            const cwd = sel.worktreePath || await invoke<string>('get_current_directory')
            await createTerminal(ids.top, cwd)
            await createTerminal(ids.bottomBase, cwd)
            // Return TerminalSet with the correct working directory
            return {
                ...ids,
                workingDirectory: cwd
            }
        }

        // Fallback: fetch session data if sessionState not provided (backward compatibility)
        try {
            const sessionData = await invoke<any>('schaltwerk_core_get_session', { name: sel.payload })
            const state: string | undefined = sessionData?.session_state
            const worktreePath: string | undefined = sel.worktreePath || sessionData?.worktree_path
            const isPlanSession = state === 'spec'
            setIsPlan(!!isPlanSession)

            if (isPlanSession) {
                // Do not create terminals for plans
                return ids
            }

            const cwd = worktreePath || await invoke<string>('get_current_directory')
            await createTerminal(ids.top, cwd)
            await createTerminal(ids.bottomBase, cwd)
            // Return TerminalSet with the correct working directory
            return {
                ...ids,
                workingDirectory: cwd
            }
        } catch (e) {
            console.error('[SelectionContext] Failed to inspect session state; not creating terminals for failed session lookup', e)
            setIsPlan(false)
            // Don't create terminals if we can't determine session state
            return ids
        }
    }, [getTerminalIds, createTerminal, projectPath])
    
    // Helper to get default selection for current project
    const getDefaultSelection = useCallback(async (): Promise<Selection> => {
        // Try to load saved selection for this project from database
        if (projectPath) {
            try {
                const dbSelection = await invoke<{ kind: string; payload: string | null } | null>('get_project_selection')
                if (dbSelection) {
                    console.log('[SelectionContext] Restored saved selection for project:', projectPath, dbSelection)
                    return {
                        kind: dbSelection.kind as 'session' | 'orchestrator',
                        payload: dbSelection.payload ?? undefined
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

        // For sessions, check if it still exists and worktree is valid
        if (remembered.kind === 'session' && remembered.payload) {
            try {
                const sessionData = await invoke<any>('schaltwerk_core_get_session', { name: remembered.payload })
                const worktreePath = sessionData?.worktree_path || remembered.worktreePath

                // Check if worktree directory still exists
                if (worktreePath) {
                    try {
                        const exists = await invoke<boolean>('directory_exists', { path: worktreePath })
                        if (!exists) {
                            console.log(`[SelectionContext] Worktree directory ${worktreePath} no longer exists for session ${remembered.payload}, falling back to orchestrator`)
                            return { kind: 'orchestrator' }
                        }
                    } catch (error) {
                        console.warn(`[SelectionContext] Failed to check worktree directory ${worktreePath}:`, error)
                        // If we can't check, assume it's invalid to be safe
                        return { kind: 'orchestrator' }
                    }
                }

                // Session and worktree are valid
                return {
                    kind: 'session',
                    payload: remembered.payload,
                    worktreePath,
                    sessionState: sessionData?.session_state
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
        
        // Check if session state is changing from plan to running (or vice versa)
        const isStateTransition = selection.kind === 'session' && 
            newSelection.kind === 'session' && 
            selection.payload === newSelection.payload &&
            isPlan !== (newSelection.sessionState === 'spec')
        
        // Check if we're actually changing selection or terminals (but allow initial setup, force recreate, or state transitions)
        if (!forceRecreate && !isStateTransition && isReady && 
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
                // CRITICAL: Update isPlan state based on the new selection
                // This was missing and causing stale isPlan when switching from plan to running
                if (newSelection.kind === 'session') {
                    const isPlanSession = newSelection.sessionState === 'spec'
                    setIsPlan(isPlanSession)
                } else {
                    // Orchestrator is never a spec
                    setIsPlan(false)
                }
                
                // Update selection and terminals immediately
                setSelectionState(newSelection)
                setTerminals(newTerminalIds)
                
                // Notify SessionsContext about the selection change to preserve position during sorting
                setCurrentSelection(newSelection.kind === 'session' ? newSelection.payload || null : null)
                
                // Save to database if this is an intentional change and not during restoration
                if (isIntentional && !isRestoringRef.current && projectPath) {
                    try {
                        await invoke('set_project_selection', {
                            kind: newSelection.kind,
                            payload: newSelection.payload ?? null
                        })
                    } catch (e) {
                        console.error('[SelectionContext] Failed to persist selection to database:', e)
                    }
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
            
            // Notify SessionsContext about the selection change to preserve position during sorting
            setCurrentSelection(newSelection.kind === 'session' ? newSelection.payload || null : null)
            
            // Save to database if this is an intentional change and not during restoration
            if (isIntentional && !isRestoringRef.current && projectPath) {
                try {
                    await invoke('set_project_selection', {
                        kind: newSelection.kind,
                        payload: newSelection.payload ?? null
                    })
                } catch (e) {
                    console.error('[SelectionContext] Failed to persist selection to database:', e)
                }
            }
            
            // Mark as ready
            setIsReady(true)

        } catch (error) {
            console.error('[SelectionContext] Failed to set selection:', error)
            // Stay on current selection if we fail
            setIsReady(true)
        }
    }, [ensureTerminals, getTerminalIds, clearTerminalTracking, isReady, selection, terminals, projectPath])

    // React to backend session refreshes (e.g., plan -> running)
    useEffect(() => {
        let unlisten: (() => void) | null = null
        const attach = async () => {
            try {
                const { listen } = await import('@tauri-apps/api/event')
                unlisten = await listen('schaltwerk:sessions-refreshed', async () => {
                    if (selection.kind !== 'session' || !selection.payload) return
                    try {
                        const sessionData = await invoke<any>('schaltwerk_core_get_session', { name: selection.payload })
                        const state: string | undefined = sessionData?.session_state
                        const worktreePath: string | undefined = sessionData?.worktree_path
                        const nowPlan = state === 'spec'
                        const wasPlan = isPlan

                        // Update isPlan state
                        setIsPlan(!!nowPlan)

                        // If state changed from plan to running, update selection and ensure terminals
                        if (wasPlan && !nowPlan) {
                            // Session became running - update the selection's sessionState
                            const updatedSelection = {
                                ...selection,
                                sessionState: state as 'spec' | 'running' | 'reviewed' | undefined,
                                worktreePath: worktreePath || selection.worktreePath
                            }
                            setSelectionState(updatedSelection)
                            
                            // Ensure terminals exist now that it's running
                            try { 
                                const ids = await ensureTerminals(updatedSelection)
                                setTerminals(ids)
                            } catch (e) {
                                console.warn('[SelectionContext] Failed to create terminals for newly running session', e)
                            }
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
    }, [selection, ensureTerminals, getTerminalIds, isPlan])
    
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
            
            
            previousProjectPath.current = projectPath
            
            // Determine target selection
            let targetSelection: Selection
            
            if (projectChanged) {
                // When switching projects, always load from database
                isRestoringRef.current = true
                try {
                    const savedSelection = await getDefaultSelection()
                    // Validate the saved selection (session might be deleted)
                    targetSelection = await validateAndRestoreSelection(savedSelection)
                } finally {
                    isRestoringRef.current = false
                }
            } else {
                // First initialization, use default but validate it
                const defaultSelection = await getDefaultSelection()
                targetSelection = await validateAndRestoreSelection(defaultSelection)
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
    
    // Listen for selection events from backend (e.g., when MCP creates/updates plans)
    useEffect(() => {
        let unlisten: (() => void) | undefined
        
        const setupSelectionListener = async () => {
            try {
                unlisten = await listen<Selection>('schaltwerk:selection', async (event) => {
                    console.log('Received selection event from backend:', event.payload)
                    // Set the selection to the requested session/plan - this is intentional (backend requested)
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
    
    
    return (
        <SelectionContext.Provider value={{ 
            selection, 
            terminals,
            setSelection,
            clearTerminalTracking,
            isReady,
            isPlan
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