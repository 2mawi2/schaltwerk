import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { SchaltEvent, listenEvent } from '../common/eventSystem'
import { invoke } from '@tauri-apps/api/core'
import { useProject } from './ProjectContext'
import { useFontSize } from './FontSizeContext'
import { useSessions } from './SessionsContext'
import { FilterMode } from '../types/sessionFilters'
import { RawSession, ProjectSelection } from '../types/session'
import { logger } from '../utils/logger'
import { useModal } from './ModalContext'

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
    isSpec: boolean
}

const SelectionContext = createContext<SelectionContextType | null>(null)

export function SelectionProvider({ children }: { children: React.ReactNode }) {
    const { projectPath } = useProject()
    const { terminalFontSize: _terminalFontSize } = useFontSize()
    const { setCurrentSelection, filterMode } = useSessions()
    const [selection, setSelectionState] = useState<Selection>({ kind: 'orchestrator' })
    const [terminals, setTerminals] = useState<TerminalSet>({
        top: 'orchestrator-default-top',
        bottomBase: 'orchestrator-default-bottom',
        workingDirectory: ''
    })
    // Start as not ready, will become ready once we have initialized with a project
    const [isReady, setIsReady] = useState(false)
    const [isSpec, setIsSpec] = useState(false)
    const previousProjectPath = useRef<string | null>(null)
    const hasInitialized = useRef(false)
    const { isAnyModalOpen, openModals } = useModal()
    const pendingSelectionRef = useRef<Selection | null>(null)
    
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
                const exists = await invoke<boolean>(TauriCommands.TerminalExists, { id })
                if (!exists) {
                    await invoke(TauriCommands.CreateTerminal, { id, cwd })
                }
                terminalsCreated.current.add(id)
            } catch (error) {
                logger.error(`Failed to create terminal ${id}:`, error)
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

        // Orchestrator always has terminals and is never a spec
        if (sel.kind === 'orchestrator') {
            setIsSpec(false)
            const cwd = projectPath || await invoke<string>(TauriCommands.GetCurrentDirectory)
            await createTerminal(ids.top, cwd)
            return ids
        }

        // Always fetch session data to ensure we have the correct worktree path
        try {
            const sessionData = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: sel.payload })
            const state: string | undefined = sessionData?.session_state
            const worktreePath: string | undefined = sessionData?.worktree_path
            const isSpecSession = state === 'spec'
            setIsSpec(!!isSpecSession)

            if (isSpecSession) {
                // Do not create terminals for specs
                return ids
            }

            // For running sessions, worktree_path must exist
            if (!worktreePath) {
                logger.error(`[SelectionContext] Session ${sel.payload} is not a spec but has no worktree_path`)
                // Don't create terminals with incorrect working directory
                return ids
            }

            // Verify worktree directory exists and is valid before creating terminals
            try {
                const exists = await invoke<boolean>(TauriCommands.PathExists, { path: worktreePath })
                if (!exists) {
                    logger.warn(`[SelectionContext] Worktree path does not exist for session ${sel.payload}: ${worktreePath}`)
                    return ids
                }
                
                // Additional check: ensure it's a valid git worktree
                const gitDir = `${worktreePath}/.git`
                const hasGit = await invoke<boolean>(TauriCommands.PathExists, { path: gitDir })
                if (!hasGit) {
                    logger.warn(`[SelectionContext] Worktree is not properly initialized for session ${sel.payload}: ${worktreePath}`)
                    return ids
                }
            } catch (e) {
                logger.warn(`[SelectionContext] Could not verify worktree path for session ${sel.payload}:`, e)
                return ids
            }

            await createTerminal(ids.top, worktreePath)
            // Proactively close legacy base bottom terminals if they exist to avoid orphans
            try {
                const legacyExists = await invoke<boolean>(TauriCommands.TerminalExists, { id: ids.bottomBase })
                if (legacyExists) {
                    await invoke(TauriCommands.CloseTerminal, { id: ids.bottomBase })
                    terminalsCreated.current.delete(ids.bottomBase)
                }
            } catch (e) {
                logger.warn(`[SelectionContext] Failed to cleanup legacy bottom terminal for ${sel.payload}:`, e)
            }
            // Bottom terminals are managed by TerminalTabs (tabbed: -bottom-0, -bottom-1, ...)
            // Do not create the base bottom terminal here to avoid orphan terminals
            // Return TerminalSet with the correct working directory
            return {
                ...ids,
                workingDirectory: worktreePath
            }
        } catch (e) {
            logger.error('[SelectionContext] Failed to inspect session state; not creating terminals for failed session lookup', e)
            setIsSpec(false)
            // Don't create terminals if we can't determine session state
            return ids
        }
    }, [getTerminalIds, createTerminal, projectPath])
    
    // Helper to get default selection for current project
    const getDefaultSelection = useCallback(async (): Promise<Selection> => {
        // Try to load saved selection for this project from database
        if (projectPath) {
            try {
                const dbSelection = await invoke<ProjectSelection | null>(TauriCommands.GetProjectSelection)
                if (dbSelection) {
                    logger.info('[SelectionContext] Restored saved selection for project:', projectPath, dbSelection)
                    return {
                        kind: dbSelection.kind as 'session' | 'orchestrator',
                        payload: dbSelection.payload ?? undefined
                    }
                }
            } catch (error) {
                logger.error('[SelectionContext] Failed to load saved selection:', error)
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
                const sessionData = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: remembered.payload })
                const worktreePath = sessionData?.worktree_path || remembered.worktreePath

                // Check if worktree directory still exists
                if (worktreePath) {
                    try {
                        const exists = await invoke<boolean>(TauriCommands.DirectoryExists, { path: worktreePath })
                        if (!exists) {
                            logger.info(`[SelectionContext] Worktree directory ${worktreePath} no longer exists for session ${remembered.payload}, falling back to orchestrator`)
                            return { kind: 'orchestrator' }
                        }
                    } catch (error) {
                        logger.warn(`[SelectionContext] Failed to check worktree directory ${worktreePath}:`, error)
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
                logger.info(`[SelectionContext] Session ${remembered.payload} no longer exists, falling back to orchestrator`, error)
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
                const exists = await invoke<boolean>(TauriCommands.TerminalExists, { id })
                if (exists) {
                    await invoke(TauriCommands.CloseTerminal, { id })
                }
            } catch (e) {
                logger.warn(`[SelectionContext] Failed to close terminal ${id}:`, e)
            }
        }
    }, [])
    
    // Set selection atomically
    const setSelection = useCallback(async (newSelection: Selection, forceRecreate = false, isIntentional = false) => {
        // Mark session switching to prevent terminal resize interference
        document.body.classList.add('session-switching')
        
        // Get the new terminal IDs to check if they're changing
        const newTerminalIds = getTerminalIds(newSelection)
        
        // Check if session state is changing from spec to running (or vice versa)
        const isStateTransition = selection.kind === 'session' && 
            newSelection.kind === 'session' && 
            selection.payload === newSelection.payload &&
            isSpec !== (newSelection.sessionState === 'spec')
        
        // Check if we're actually changing selection or terminals (but allow initial setup, force recreate, or state transitions)
        if (!forceRecreate && !isStateTransition && isReady && 
            selection.kind === newSelection.kind && 
            selection.payload === newSelection.payload &&
            terminals.top === newTerminalIds.top) {
            // Remove session switching class if no actual change
            document.body.classList.remove('session-switching')
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
                // CRITICAL: Update isSpec state based on the new selection
                // This was missing and causing stale isSpec when switching from spec to running
                if (newSelection.kind === 'session') {
                    const isSpecSession = newSelection.sessionState === 'spec'
                    setIsSpec(isSpecSession)
                } else {
                    // Orchestrator is never a spec
                    setIsSpec(false)
                }
                
                // Update selection and terminals immediately
                setSelectionState(newSelection)
                setTerminals(newTerminalIds)
                
                // Notify SessionsContext about the selection change to preserve position during sorting
                setCurrentSelection(newSelection.kind === 'session' ? newSelection.payload || null : null)
                
                // Save to database if this is an intentional change and not during restoration
                if (isIntentional && !isRestoringRef.current && projectPath) {
                    try {
                        await invoke(TauriCommands.SetProjectSelection, {
                            kind: newSelection.kind,
                            payload: newSelection.payload ?? null
                        })
                    } catch (e) {
                        logger.error('[SelectionContext] Failed to persist selection to database:', e)
                    }
                }
                
                // Ensure ready state
                if (!isReady) {
                    setIsReady(true)
                }
                
                // Remove session switching class after immediate switch and nudge OpenCode terminal to refit
                requestAnimationFrame(() => {
                    document.body.classList.remove('session-switching')
                    try {
                        const detail = newSelection.kind === 'session'
                          ? { kind: 'session', sessionId: newSelection.payload }
                          : { kind: 'orchestrator' as const }
                        window.dispatchEvent(new CustomEvent('schaltwerk:opencode-selection-resize', { detail }))
                    } catch { /* no-op */ }
                })
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
                    await invoke(TauriCommands.SetProjectSelection, {
                        kind: newSelection.kind,
                        payload: newSelection.payload ?? null
                    })
                } catch (e) {
                    logger.error('[SelectionContext] Failed to persist selection to database:', e)
                }
            }
            
            // Mark as ready
            setIsReady(true)

        } catch (error) {
            logger.error('[SelectionContext] Failed to set selection:', error)
            // Stay on current selection if we fail
            setIsReady(true)
        } finally {
            // Always remove session switching class after selection change completes
            requestAnimationFrame(() => {
                document.body.classList.remove('session-switching')
                try {
                    const detail = newSelection.kind === 'session'
                      ? { kind: 'session', sessionId: newSelection.payload }
                      : { kind: 'orchestrator' as const }
                    window.dispatchEvent(new CustomEvent('schaltwerk:opencode-selection-resize', { detail }))
                } catch { /* no-op */ }
            })
        }
    }, [ensureTerminals, getTerminalIds, clearTerminalTracking, isReady, selection, terminals, projectPath, isSpec, setCurrentSelection])

    // React to backend session refreshes (e.g., spec -> running)
    useEffect(() => {
        let unlisten: (() => void) | null = null
        const attach = async () => {
            try {
                unlisten = await listenEvent(SchaltEvent.SessionsRefreshed, async () => {
                    if (selection.kind !== 'session' || !selection.payload) return
                    try {
                        const sessionData = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: selection.payload })
                        const state: string | undefined = sessionData?.session_state
                        const worktreePath: string | undefined = sessionData?.worktree_path
                        const nowSpec = state === 'spec'
                        const wasSpec = isSpec

                        // Update isSpec state
                        setIsSpec(!!nowSpec)

                        // If state changed from spec to running, update selection and ensure terminals
                        if (wasSpec && !nowSpec) {
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
                                logger.warn('[SelectionContext] Failed to create terminals for newly running session', e)
                            }
                        }
                    } catch (e) {
                        logger.warn('[SelectionContext] Failed to refresh current session state after event', e)
                    }
                })
            } catch (e) {
                logger.warn('[SelectionContext] Failed to attach sessions-refreshed listener', e)
            }
        }
        attach()
        return () => { try { if (unlisten) unlisten() } catch {
            // Cleanup failed, ignore
        } }
    }, [selection, ensureTerminals, getTerminalIds, isSpec])
    
    // Initialize on mount and when project path changes
    useEffect(() => {
        const initialize = async () => {
            logger.info('[SelectionContext] Initialize effect triggered, projectPath:', projectPath)
            
            // Wait for projectPath to be set before initializing
            if (!projectPath) {
                logger.info('[SelectionContext] No projectPath, skipping initialization')
                return
            }
            
            // Skip if already initialized with same project path
            if (hasInitialized.current && previousProjectPath.current === projectPath) {
                logger.info('[SelectionContext] Already initialized with same project path, skipping')
                return
            }
            
            // Check if we're switching projects
            const projectChanged = hasInitialized.current && 
                                  previousProjectPath.current !== null && 
                                  previousProjectPath.current !== projectPath
            
            logger.info('[SelectionContext] Project changed?', projectChanged, 'Previous:', previousProjectPath.current, 'New:', projectPath)
            
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
            
            logger.info('[SelectionContext] Setting selection to:', targetSelection)
            
            // Avoid overriding an explicit selection that may have been set concurrently
            // Only apply the automatic restoration if we're still on the default orchestrator
            if (selection.kind === 'orchestrator') {
                // Set the selection - the orchestrator terminals are already project-specific via the ID hash
                // No need to force recreate, just switch to the correct project's orchestrator
                await setSelection(targetSelection, false, false) // Not intentional - this is automatic restoration
            } else {
                logger.info('[SelectionContext] Skipping automatic selection restore; user selection already set')
            }
        }
        
        // Only run if not currently initializing
        initialize().catch(error => {
            logger.error('[SelectionContext] Failed to initialize:', error)
            // Still mark as ready even on error so UI doesn't hang
            setIsReady(true)
        })
    }, [projectPath, setSelection, getTerminalIds, validateAndRestoreSelection, getDefaultSelection, selection]) // Re-run when projectPath changes
    
    // Listen for selection events from backend (e.g., when MCP creates/updates specs)
    useEffect(() => {
        let unlisten: (() => void) | undefined
        
        const setupSelectionListener = async () => {
            try {
                unlisten = await listenEvent(SchaltEvent.Selection, async (target) => {
                    logger.info('Received selection event from backend:', target)

                    // Guard: Don't auto-switch to a spec when user is focused on a running session
                    // and the sidebar filter is set to Running. This avoids jumping away from terminals
                    // when a new spec is created by MCP/background.
                    if (target?.kind === 'session') {
                        let targetIsSpec = target.sessionState === 'spec'

                        // If the event didn't include sessionState, resolve it
                        if (target.sessionState === undefined) {
                            try {
                                const sessionData = await invoke<RawSession>(TauriCommands.SchaltwerkCoreGetSession, { name: target.payload })
                                targetIsSpec = sessionData?.session_state === 'spec'
                            } catch (e) {
                                logger.warn('[SelectionContext] Failed to resolve session state for backend selection event:', e)
                            }
                        }

                        // If currently on a running session and filter hides specs, ignore spec selection
                        if (
                            targetIsSpec &&
                            selection.kind === 'session' &&
                            !isSpec &&
                            filterMode === FilterMode.Running
                        ) {
                            logger.info('[SelectionContext] Ignoring backend spec selection to preserve running session focus under Running filter')
                            return
                        }
                    }

                    // If any modal is open, defer selection until after modals close
                    if (isAnyModalOpen()) {
                        logger.info('[SelectionContext] Modal open; deferring backend selection until modals close')
                        pendingSelectionRef.current = target
                        return
                    }
                    // Set the selection to the requested session/spec - this is intentional (backend requested)
                    await setSelection(target, false, true)
                })
            } catch (e) {
                logger.error('[SelectionContext] Failed to attach selection listener', e)
            }
        }
        
        setupSelectionListener()
        
        return () => {
            if (unlisten) {
                unlisten()
            }
        }
    }, [setSelection, selection, isSpec, filterMode, isAnyModalOpen])

    // When modals close, apply any deferred selection
    useEffect(() => {
        if (openModals.size === 0 && pendingSelectionRef.current) {
            const pending = pendingSelectionRef.current
            pendingSelectionRef.current = null
            logger.info('[SelectionContext] Applying deferred backend selection now that modals are closed:', pending)
            setSelection(pending, false, true).catch(e => logger.error('Failed to apply deferred selection:', e))
        }
    }, [openModals, setSelection])
    
    
    return (
        <SelectionContext.Provider value={{ 
            selection, 
            terminals,
            setSelection,
            clearTerminalTracking,
            isReady,
            isSpec
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
