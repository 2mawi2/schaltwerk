import { Terminal, TerminalHandle } from './Terminal'
import { TauriCommands } from '../../common/tauriCommands'
import { TerminalTabs, TerminalTabsHandle } from './TerminalTabs'
import { RunTerminal, RunTerminalHandle } from './RunTerminal'
import { UnifiedBottomBar } from './UnifiedBottomBar'
import { SpecPlaceholder } from '../plans/SpecPlaceholder'
import TerminalErrorBoundary from '../TerminalErrorBoundary'
import Split from 'react-split'
import { useSelection } from '../../contexts/SelectionContext'
import { useFocus } from '../../contexts/FocusContext'
import { useRun } from '../../contexts/RunContext'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { useSessions } from '../../contexts/SessionsContext'
import { AgentType } from '../../types/session'
import { useActionButtons } from '../../contexts/ActionButtonsContext'
import { invoke } from '@tauri-apps/api/core'
import { getActionButtonColorClasses } from '../../constants/actionButtonColors'
import { ConfirmResetDialog } from '../common/ConfirmResetDialog'
import { VscDiscard } from 'react-icons/vsc'
import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { mapSessionUiState } from '../../utils/sessionFilters'
import { logger } from '../../utils/logger'
import { loadRunScriptConfiguration } from '../../utils/runScriptLoader'
import { useModal } from '../../contexts/ModalContext'
import { safeTerminalFocus } from '../../utils/safeFocus'
import { UiEvent, emitUiEvent, listenUiEvent, TerminalResetDetail } from '../../common/uiEvents'

type TerminalTabDescriptor = { index: number; terminalId: string; label: string }
type TerminalTabsUiState = {
    tabs: TerminalTabDescriptor[]
    activeTab: number
    canAddTab: boolean
}

const createInitialTabsState = (baseTerminalId: string): TerminalTabsUiState => ({
    tabs: [{ index: 0, terminalId: baseTerminalId, label: 'Terminal 1' }],
    activeTab: 0,
    canAddTab: true,
})

const cloneTabsState = (state: TerminalTabsUiState): TerminalTabsUiState => ({
    tabs: state.tabs.map(tab => ({ ...tab })),
    activeTab: state.activeTab,
    canAddTab: state.canAddTab,
})

export function TerminalGrid() {
    const { selection, terminals, isReady, isSpec } = useSelection()
    const { getFocusForSession, setFocusForSession, currentFocus } = useFocus()
    const { addRunningSession, removeRunningSession } = useRun()
    const { getAgentType, getOrchestratorAgentType } = useClaudeSession()
    const { actionButtons } = useActionButtons()
    const { sessions } = useSessions()
    const { isAnyModalOpen } = useModal()
    
    // Show action buttons for both orchestrator and sessions
    const shouldShowActionButtons = (selection.kind === 'orchestrator' || selection.kind === 'session') && actionButtons.length > 0
    
    const [terminalKey, setTerminalKey] = useState(0)
    const [localFocus, setLocalFocus] = useState<'claude' | 'terminal' | null>(null)
    const [agentType, setAgentType] = useState<string>('claude')
    
    // Constants for special tab indices
    const RUN_TAB_INDEX = -1 // Special index for the Run tab
    
    // Get session key for persistence
    const sessionKey = selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown'
    const activeTabKey = `schaltwerk:active-tab:${sessionKey}`
    
    const [terminalTabsState, setTerminalTabsState] = useState<TerminalTabsUiState>(() =>
        createInitialTabsState(terminals.bottomBase)
    )
    const tabsStateStoreRef = useRef<Map<string, TerminalTabsUiState>>(new Map())
    const terminalTabsStateRef = useRef<TerminalTabsUiState>(terminalTabsState)
    const previousTabsBaseRef = useRef<string | null>(terminals.bottomBase)
    const previousTerminalKeyRef = useRef<number>(terminalKey)
    const currentTabsOwnerRef = useRef<string | null>(terminals.bottomBase)
    const applyTabsState = useCallback(
        (updater: (prev: TerminalTabsUiState) => TerminalTabsUiState) => {
            setTerminalTabsState(prev => {
                const next = updater(prev)
                currentTabsOwnerRef.current = terminals.bottomBase
                return next
            })
        },
        [terminals.bottomBase]
    )
    const containerRef = useRef<HTMLDivElement>(null)
    const [collapsedPercent, setCollapsedPercent] = useState<number>(10) // fallback ~ header height in % with safety margin
    // Initialize persisted UI state synchronously to avoid extra re-renders that remount children in tests
    const initialPersistKey = selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown'
    const initialIsCollapsed = (sessionStorage.getItem(`schaltwerk:terminal-grid:collapsed:${initialPersistKey}`) === 'true')
    const initialExpanded = (() => {
        const rawExpanded = sessionStorage.getItem(`schaltwerk:terminal-grid:lastExpandedBottom:${initialPersistKey}`)
        const v = rawExpanded ? Number(rawExpanded) : NaN
        return !Number.isNaN(v) && v > 0 && v < 100 ? v : 30
    })()
    const [isBottomCollapsed, setIsBottomCollapsed] = useState<boolean>(initialIsCollapsed)
    const [lastExpandedBottomPercent, setLastExpandedBottomPercent] = useState<number>(initialExpanded)
    const isDraggingRef = useRef(false)
    const [sizes, setSizes] = useState<number[]>(() => {
        const raw = sessionStorage.getItem(`schaltwerk:terminal-grid:sizes:${initialPersistKey}`)
        let base: number[] = [70, 30]
        if (raw) {
            try { const parsed = JSON.parse(raw) as number[]; if (Array.isArray(parsed) && parsed.length === 2) base = parsed } catch {
                // JSON parsing failed, use default
            }
        }
        if (initialIsCollapsed) {
            const pct = 8
            return [100 - pct, pct]
        }
        return base
    })
    
    const claudeTerminalRef = useRef<TerminalHandle>(null)
    const terminalTabsRef = useRef<TerminalTabsHandle>(null)
    const runTerminalRefs = useRef<Map<string, RunTerminalHandle>>(new Map())
    const [isDraggingSplit, setIsDraggingSplit] = useState(false)
    const [confirmResetOpen, setConfirmResetOpen] = useState(false)
    const [isResetting, setIsResetting] = useState(false)
    const handleConfirmReset = useCallback(async () => {
        if (selection.kind !== 'session' || !selection.payload) return
        try {
            setIsResetting(true)
            await invoke(TauriCommands.SchaltwerkCoreResetSessionWorktree, { sessionName: selection.payload })
            emitUiEvent(UiEvent.TerminalReset, { kind: 'session', sessionId: selection.payload })
            setConfirmResetOpen(false)
        } catch (err) {
            logger.error('[TerminalGrid] Failed to reset session worktree:', err)
        } finally {
            setIsResetting(false)
        }
    }, [selection])
    
    // Run Mode state
    const [hasRunScripts, setHasRunScripts] = useState(false)
    const [runModeActive, setRunModeActive] = useState(false)
    const [activeRunSessions, setActiveRunSessions] = useState<Set<string>>(new Set())
    const [pendingRunToggle, setPendingRunToggle] = useState(false)
    

    const getSessionKey = useCallback(() => {
        return sessionKey
    }, [sessionKey])

    // Computed tabs that include Run tab when active
    const computedTabs = useMemo(() => {
        const showRunTab = hasRunScripts && runModeActive
        const baseTabs = [...terminalTabsState.tabs]
        
        if (showRunTab) {
            // Add Run tab at index 0
            const runTab = { index: 0, terminalId: 'run-terminal', label: 'Run' }
            // Shift existing terminal tabs by +1
            const shiftedTabs = baseTabs.map(tab => ({ ...tab, index: tab.index + 1 }))
            return [runTab, ...shiftedTabs]
        }
        
        return baseTabs
    }, [hasRunScripts, runModeActive, terminalTabsState.tabs])

    const computedActiveTab = useMemo(() => {
        const showRunTab = hasRunScripts && runModeActive
        if (showRunTab) {
            // If activeTab is RUN_TAB_INDEX, it means Run tab is selected
            if (terminalTabsState.activeTab === RUN_TAB_INDEX) {
                return 0 // Run tab is at index 0
            }
            return terminalTabsState.activeTab + 1 // Shift by +1 for Run tab
        }
        return terminalTabsState.activeTab
    }, [hasRunScripts, runModeActive, terminalTabsState.activeTab, RUN_TAB_INDEX])

    const toggleTerminalCollapsed = () => {
        const newCollapsed = !isBottomCollapsed
        setIsBottomCollapsed(newCollapsed)
        
        if (newCollapsed) {
            // When collapsing, save current size and set to collapsed size
            const currentBottom = sizes[1]
            if (currentBottom > collapsedPercent) {
                setLastExpandedBottomPercent(currentBottom)
            }
            setSizes([100 - collapsedPercent, collapsedPercent])
        } else {
            // When expanding, restore to last expanded size
            const expandedSize = lastExpandedBottomPercent || 28
            setSizes([100 - expandedSize, expandedSize])
        }
    }
    
    // Listen for terminal reset events and focus terminal events
    useEffect(() => {
        const handleTerminalReset = (detail?: TerminalResetDetail) => {
            if (!detail) {
                logger.debug('[TerminalGrid] Ignoring reset event without detail')
                return
            }

            if (detail.kind === 'orchestrator') {
                if (selection.kind !== 'orchestrator') {
                    return
                }
            } else if (detail.kind === 'session') {
                if (
                    selection.kind !== 'session'
                    || !selection.payload
                    || selection.payload !== detail.sessionId
                ) {
                    return
                }
            }

            setTerminalKey(prev => prev + 1)
        }

        // Track the last specifically requested terminal focus so we can apply it when ready
        let lastRequestedTerminalId: string | null = null

        const handleFocusTerminal = (detail?: { terminalId?: string; focusType?: 'terminal' | 'claude' }) => {
            // Don't focus terminal if any modal is open
            if (isAnyModalOpen()) return

            // Expand if collapsed
            if (isBottomCollapsed) {
                const expandedSize = lastExpandedBottomPercent || 28
                setSizes([100 - expandedSize, expandedSize])
                setIsBottomCollapsed(false)
            }

            // If a specific terminalId was provided, prefer focusing that one
            const targetId = detail?.terminalId || null
            if (targetId) {
                lastRequestedTerminalId = targetId
                safeTerminalFocus(() => {
                    terminalTabsRef.current?.focusTerminal(targetId)
                }, isAnyModalOpen)
            } else {
                // Fallback: focus the active tab
                safeTerminalFocus(() => {
                    terminalTabsRef.current?.focus()
                }, isAnyModalOpen)
            }
        }

        // When a terminal instance finishes hydrating, it emits 'schaltwerk:terminal-ready'.
        // If that matches the last requested terminal to focus, focus it deterministically now.
        const handleTerminalReady = (detail?: { terminalId: string }) => {
            if (isAnyModalOpen()) return
            if (!detail) return
            if (lastRequestedTerminalId && detail.terminalId === lastRequestedTerminalId) {
                safeTerminalFocus(() => {
                    terminalTabsRef.current?.focusTerminal(detail.terminalId)
                }, isAnyModalOpen)
                // Clear to avoid repeated focusing
                lastRequestedTerminalId = null
            }
        }

        const cleanupReset = listenUiEvent(UiEvent.TerminalReset, handleTerminalReset)
        const cleanupFocus = listenUiEvent(UiEvent.FocusTerminal, handleFocusTerminal)
        const cleanupReady = listenUiEvent(UiEvent.TerminalReady, handleTerminalReady)
        return () => {
            cleanupReset()
            cleanupFocus()
            cleanupReady()
        }
    }, [isBottomCollapsed, lastExpandedBottomPercent, runModeActive, terminalTabsState.activeTab, isAnyModalOpen, selection.kind, selection.payload])

    // Fetch agent type based on selection
    useEffect(() => {
        // For sessions, get the session-specific agent type
        if (selection.kind === 'session' && selection.payload) {
            const session = sessions.find(s => s.info.session_id === selection.payload)
            if (!session) {
                logger.warn(`Session not found: ${selection.payload}, using default agent type`)
                setAgentType('claude')
                return
            }
            // Use session's original_agent_type if available, otherwise default to 'claude'
            // This handles existing sessions that don't have the field yet
            const sessionAgentType = session.info.original_agent_type as AgentType | undefined
            if (sessionAgentType) {
                logger.info(`Session ${selection.payload} agent type: ${sessionAgentType} (original_agent_type: ${session.info.original_agent_type})`)
                setAgentType(sessionAgentType)
            } else {
                getAgentType()
                    .then(type => {
                        const normalized = (type as AgentType) || 'claude'
                        setAgentType(normalized)
                    })
                    .catch(error => {
                        logger.error('Failed to get session default agent type:', error)
                        setAgentType('claude')
                    })
            }
        } else {
            // For orchestrator or when no session selected, use global agent type
            getOrchestratorAgentType().then(setAgentType).catch(error => {
                logger.error('Failed to get orchestrator agent type:', error)
                // Default to 'claude' if we can't get the global agent type
                setAgentType('claude')
            })
        }
    }, [selection, sessions, getAgentType, getOrchestratorAgentType])

    // Load run script availability and manage run mode state
    useEffect(() => {
        const initializeRunMode = async () => {
            const sessionKey = getSessionKey()
            const config = await loadRunScriptConfiguration(sessionKey)
            
            setHasRunScripts(config.hasRunScripts)
            setRunModeActive(config.shouldActivateRunMode)
            
            // Restore saved active tab if available
            if (config.savedActiveTab !== null) {
                const savedTab = config.savedActiveTab
                applyTabsState(prev => ({ ...prev, activeTab: savedTab }))
            }
        }
        
        initializeRunMode()
    }, [selection, getSessionKey, applyTabsState])

    // Focus appropriate terminal when selection changes
    useEffect(() => {
        if (!selection) return
        
        const sessionKey = getSessionKey()
        const focusArea = getFocusForSession(sessionKey)
        setLocalFocus(focusArea === 'claude' || focusArea === 'terminal' ? focusArea : null)
        
        // Focus the appropriate terminal after ensuring it's rendered
        safeTerminalFocus(() => {
            if (focusArea === 'claude' && claudeTerminalRef.current) {
                claudeTerminalRef.current.focus()
            } else if (focusArea === 'terminal' && terminalTabsRef.current) {
                terminalTabsRef.current.focus()
            }
            // TODO: Add diff focus handling when we implement it
        }, isAnyModalOpen)
    }, [selection, getFocusForSession, getSessionKey, isAnyModalOpen])

    // If global focus changes to claude/terminal, apply it immediately.
    // Avoid overriding per-session default when only the selection changed
    // but the global focus value stayed the same.
    const lastAppliedGlobalFocusRef = useRef<'claude' | 'terminal' | null>(null)
    const lastSelectionKeyRef = useRef<string>('')
    useEffect(() => {
        const sessionKey = getSessionKey()
        const focusChanged = currentFocus !== lastAppliedGlobalFocusRef.current
        const selectionChanged = sessionKey !== lastSelectionKeyRef.current

        // Update refs for next run
        lastSelectionKeyRef.current = sessionKey

        // Do nothing if we have no explicit global focus
        if (!currentFocus) {
            lastAppliedGlobalFocusRef.current = null
            return
        }

        // If selection changed but global focus did not, skip applying it so per-session
        // focus (handled in the other effect) can take precedence.
        if (selectionChanged && !focusChanged) {
            return
        }

        // Never apply programmatic focus while any modal is open
        if (isAnyModalOpen()) {
            return
        }

        // Apply the new global focus (modal-safe)
        if (currentFocus === 'claude') {
            setLocalFocus('claude')
            safeTerminalFocus(() => {
                claudeTerminalRef.current?.focus()
                // Only scroll to bottom if this is from Cmd+T shortcut
                if (window.__cmdTPressed) {
                    claudeTerminalRef.current?.scrollToBottom()
                    delete window.__cmdTPressed
                }
            }, isAnyModalOpen)
            lastAppliedGlobalFocusRef.current = 'claude'
        } else if (currentFocus === 'terminal') {
            setLocalFocus('terminal')
            safeTerminalFocus(() => {
                terminalTabsRef.current?.focus()
            }, isAnyModalOpen)
            lastAppliedGlobalFocusRef.current = 'terminal'
        } else {
            setLocalFocus(null)
            lastAppliedGlobalFocusRef.current = null
        }
    }, [currentFocus, selection, getSessionKey, isAnyModalOpen])

    // Keyboard shortcut handling for Run Mode (Cmd+E) and Terminal Focus (Cmd+/)
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Don't handle shortcuts if any modal is open
            if (isAnyModalOpen()) {
                return
            }

            // Cmd+E for Run Mode Toggle (Mac only)
            if (event.metaKey && event.key === 'e') {
                // Only handle if run scripts are available
                if (hasRunScripts) {
                    event.preventDefault()
                    
                    const sessionId = getSessionKey()
                    const runTerminalRef = runTerminalRefs.current.get(sessionId)
                    
                    // If already on Run tab, just toggle
                    if (runModeActive && terminalTabsState.activeTab === RUN_TAB_INDEX) {
                        runTerminalRef?.toggleRun()
                    } else {
                        // Switch to Run tab and set pending toggle
                        const runModeKey = `schaltwerk:run-mode:${sessionId}`
                        sessionStorage.setItem(runModeKey, 'true')
                        setRunModeActive(true)
                        applyTabsState(prev => {
                            const next = { ...prev, activeTab: RUN_TAB_INDEX }
                            sessionStorage.setItem(activeTabKey, String(RUN_TAB_INDEX))
                            return next
                        })
                        
                        // Expand terminal panel if collapsed
                        if (isBottomCollapsed) {
                            const expandedSize = lastExpandedBottomPercent || 28
                            setSizes([100 - expandedSize, expandedSize])
                            setIsBottomCollapsed(false)
                        }
                        
                        // Set flag to toggle run after RunTerminal mounts
                        setPendingRunToggle(true)
                    }
                }
            }
            
            // Cmd+/ for Terminal Focus (Mac only)
            if (event.metaKey && event.key === '/') {
                event.preventDefault()
                
                const sessionKey = getSessionKey()
                const lastFocus = getFocusForSession(sessionKey)
                
                // Special handling: if we're on the run tab, switch to terminal tab
                const isOnRunTab = runModeActive && terminalTabsState.activeTab === RUN_TAB_INDEX
                
                if (isOnRunTab) {
                    // Switch from run tab to first terminal tab
                    applyTabsState(prev => {
                        const next = { ...prev, activeTab: 0 }
                        sessionStorage.setItem(activeTabKey, String(0))
                        return next
                    })
                    
                    // Always focus terminal when switching from run tab
                    setFocusForSession(sessionKey, 'terminal')
                    setLocalFocus('terminal')
                    
                    // Expand if collapsed
                    if (isBottomCollapsed) {
                        const expandedSize = lastExpandedBottomPercent || 28
                        setSizes([100 - expandedSize, expandedSize])
                        setIsBottomCollapsed(false)
                    }
                    
                    // Focus the terminal
                    requestAnimationFrame(() => {
                        terminalTabsRef.current?.focus()
                    })
                } else {
                    // Not on run tab - use normal focus logic
                    // Focus the last focused terminal (claude or terminal)
                    // Default to terminal if no previous focus or invalid focus
                    const targetFocus = (lastFocus === 'claude' || lastFocus === 'terminal') ? lastFocus : 'terminal'
                    
                    // Set focus for session
                    setFocusForSession(sessionKey, targetFocus)
                    setLocalFocus(targetFocus)
                    
                    // Expand terminal panel if collapsed and focusing terminal
                    if (targetFocus === 'terminal' && isBottomCollapsed) {
                        const expandedSize = lastExpandedBottomPercent || 28
                        setSizes([100 - expandedSize, expandedSize])
                        setIsBottomCollapsed(false)
                    }
                    
                    // Focus the appropriate terminal
                    requestAnimationFrame(() => {
                        if (targetFocus === 'claude' && claudeTerminalRef.current) {
                            claudeTerminalRef.current.focus()
                        } else if (targetFocus === 'terminal' && terminalTabsRef.current) {
                            terminalTabsRef.current.focus()
                        }
                    })
                }
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [hasRunScripts, isBottomCollapsed, lastExpandedBottomPercent, runModeActive, terminalTabsState.activeTab, sessionKey, getFocusForSession, setFocusForSession, isAnyModalOpen, activeTabKey, RUN_TAB_INDEX, getSessionKey, applyTabsState])

    // Handle pending run toggle after RunTerminal mounts with proper timing
    useEffect(() => {
        if (!pendingRunToggle) return
        
        // Check if we're on the Run tab
        if (runModeActive && terminalTabsState.activeTab === RUN_TAB_INDEX) {
            const sessionId = getSessionKey()
            
            logger.info('[TerminalGrid] Setting up pending run toggle for session:', sessionId)
            
            let frameId: number
            let attemptCount = 0
            const maxAttempts = 10 // Try up to 10 frames (about 160ms at 60fps)
            
            const tryToggleRun = () => {
                attemptCount++
                const runTerminalRef = runTerminalRefs.current.get(sessionId)
                
                if (runTerminalRef) {
                    // RunTerminal is ready, toggle it
                    logger.info('[TerminalGrid] Executing pending toggle after mount (attempt', attemptCount, ')')
                    runTerminalRef.toggleRun()
                    setPendingRunToggle(false)
                } else if (attemptCount < maxAttempts) {
                    // Keep trying on next frame
                    frameId = requestAnimationFrame(tryToggleRun)
                } else {
                    // Give up after max attempts
                    logger.error('[TerminalGrid] RunTerminal not ready after', maxAttempts, 'attempts, giving up')
                    setPendingRunToggle(false)
                }
            }
            
            // Start trying after two frames to allow React to complete its render cycle
            frameId = requestAnimationFrame(() => {
                requestAnimationFrame(tryToggleRun)
            })
            
            return () => {
                if (frameId) cancelAnimationFrame(frameId)
            }
        }
    }, [pendingRunToggle, runModeActive, terminalTabsState.activeTab, RUN_TAB_INDEX, getSessionKey])

    // Compute collapsed percent based on actual header height and container size
    useEffect(() => {
        if (!isBottomCollapsed) return
        const compute = () => {
            const container = containerRef.current
            if (!container) return
            const total = container.clientHeight
            if (total <= 0) return
            const headerEl = container.querySelector('[data-bottom-header]') as HTMLElement | null
            const headerHeight = headerEl?.offsetHeight || 40
            const minPixels = 44
            const minPct = (minPixels / total) * 100
            const pct = Math.max(minPct, Math.min(15, (headerHeight / total) * 100))
            if (Math.abs(pct - collapsedPercent) > 1.0) {
                setCollapsedPercent(pct)
                requestAnimationFrame(() => setSizes([100 - pct, pct]))
            }
        }
        let rafPending = false
        const schedule = () => {
            if (rafPending) return
            rafPending = true
            requestAnimationFrame(() => {
                rafPending = false
                compute()
            })
        }
        // Initial computation (RAF) and observe size changes
        schedule()
        const ro = new ResizeObserver(schedule)
        if (containerRef.current) ro.observe(containerRef.current)
        return () => { ro.disconnect() }
    }, [isBottomCollapsed, collapsedPercent])

    // Load sizes/collapse state when selection changes (avoid unnecessary updates)
    const getStorageKey = useCallback(() => (selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown'), [selection.kind, selection.payload])
    useEffect(() => {
        const key = getStorageKey()
        const raw = sessionStorage.getItem(`schaltwerk:terminal-grid:sizes:${key}`)
        const rawCollapsed = sessionStorage.getItem(`schaltwerk:terminal-grid:collapsed:${key}`)
        const rawExpanded = sessionStorage.getItem(`schaltwerk:terminal-grid:lastExpandedBottom:${key}`)
        let nextSizes: number[] = [72, 28]
        let expandedBottom = 28
        
        if (raw) {
            try { const parsed = JSON.parse(raw) as number[]; if (Array.isArray(parsed) && parsed.length === 2) nextSizes = parsed } catch {
                // JSON parsing failed, use default
            }
        }
        if (rawExpanded) { const v = Number(rawExpanded); if (!Number.isNaN(v) && v > 0 && v < 100) expandedBottom = v }
        
        // Only change collapsed state if there's an explicit localStorage value for this session
        // Otherwise, keep the current collapsed state
        if (rawCollapsed !== null) {
            const collapsed = rawCollapsed === 'true'
            setIsBottomCollapsed(collapsed)
            if (collapsed) {
                const pct = collapsedPercent
                const target = [100 - pct, pct]
                if (sizes[0] !== target[0] || sizes[1] !== target[1]) setSizes(target)
            } else {
                if (sizes[0] !== nextSizes[0] || sizes[1] !== nextSizes[1]) setSizes(nextSizes)
            }
        } else {
            // No localStorage entry - keep current collapsed state but update sizes
            if (!isBottomCollapsed) {
                if (sizes[0] !== nextSizes[0] || sizes[1] !== nextSizes[1]) setSizes(nextSizes)
            }
        }
        
        setLastExpandedBottomPercent(expandedBottom)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selection])

    // Persist when sizes change (and not collapsed)
    useEffect(() => {
        if (!sizes) return
        const key = getStorageKey()
        sessionStorage.setItem(`schaltwerk:terminal-grid:sizes:${key}`, JSON.stringify(sizes))
        if (!isBottomCollapsed) {
            setLastExpandedBottomPercent(sizes[1])
            sessionStorage.setItem(`schaltwerk:terminal-grid:lastExpandedBottom:${key}`, String(sizes[1]))
        }
    }, [sizes, isBottomCollapsed, sessionKey, getStorageKey])

    // Safety net: ensure dragging state is cleared if pointer ends outside the gutter/component
    useEffect(() => {
        const handlePointerEnd = () => {
            if (!isDraggingRef.current) return
            isDraggingRef.current = false
            document.body.classList.remove('is-split-dragging')
            window.dispatchEvent(new Event('terminal-split-drag-end'))
            setIsDraggingSplit(false)
        }
        window.addEventListener('pointerup', handlePointerEnd)
        window.addEventListener('pointercancel', handlePointerEnd)
        return () => {
            window.removeEventListener('pointerup', handlePointerEnd)
            window.removeEventListener('pointercancel', handlePointerEnd)
        }
    }, [])

    // Persist collapsed state
    useEffect(() => {
        const key = getStorageKey()
        sessionStorage.setItem(`schaltwerk:terminal-grid:collapsed:${key}`, String(isBottomCollapsed))
    }, [isBottomCollapsed, selection, sessionKey, getStorageKey])

    // Keep a mutable reference of the latest terminal tabs state for persistence between sessions
    useEffect(() => {
        terminalTabsStateRef.current = terminalTabsState
    }, [terminalTabsState])

    // Persist the latest state for the active session whenever tabs change
    useEffect(() => {
        const base = terminals.bottomBase
        if (!base) return
        if (currentTabsOwnerRef.current !== base) {
            return
        }
        tabsStateStoreRef.current.set(base, cloneTabsState(terminalTabsState))
    }, [terminalTabsState, terminals.bottomBase])

    // Restore per-session tab state on selection changes and respect explicit reset signals
    useEffect(() => {
        const currentBase = terminals.bottomBase
        const previousBase = previousTabsBaseRef.current
        const previousKey = previousTerminalKeyRef.current

        if (previousBase && previousBase !== currentBase) {
            tabsStateStoreRef.current.set(previousBase, cloneTabsState(terminalTabsStateRef.current))
        }

        if (!currentBase) {
            previousTabsBaseRef.current = currentBase
            previousTerminalKeyRef.current = terminalKey
            return
        }

        if (terminalKey !== previousKey) {
            tabsStateStoreRef.current.delete(currentBase)
        }

        const stored = tabsStateStoreRef.current.get(currentBase)
        if (stored) {
            currentTabsOwnerRef.current = currentBase
            setTerminalTabsState(cloneTabsState(stored))
        } else {
            const initialState = createInitialTabsState(currentBase)
            tabsStateStoreRef.current.set(currentBase, initialState)
            currentTabsOwnerRef.current = currentBase
            setTerminalTabsState(initialState)
        }

        previousTabsBaseRef.current = currentBase
        previousTerminalKeyRef.current = terminalKey
    }, [terminals.bottomBase, terminalKey])

    const handleClaudeSessionClick = async (e?: React.MouseEvent) => {
        // Prevent event from bubbling if called from child
        e?.stopPropagation()
        
        const sessionKey = getSessionKey()
        setFocusForSession(sessionKey, 'claude')
        setLocalFocus('claude')
        
        // Only focus the terminal, don't restart Claude
        // Claude is already auto-started by the Terminal component when first mounted
        // Use requestAnimationFrame for more reliable focus
        safeTerminalFocus(() => {
            claudeTerminalRef.current?.focus()
        }, isAnyModalOpen)
    }

    const handleTerminalClick = (e?: React.MouseEvent) => {
        // Prevent event from bubbling if called from child
        e?.stopPropagation()
        
        const sessionKey = getSessionKey()
        setFocusForSession(sessionKey, 'terminal')
        setLocalFocus('terminal')
        // If collapsed, uncollapse first
        if (isBottomCollapsed) {
            const expanded = lastExpandedBottomPercent || 28
            setSizes([100 - expanded, expanded])
            setIsBottomCollapsed(false)
            safeTerminalFocus(() => {
                terminalTabsRef.current?.focus()
            }, isAnyModalOpen)
            return
        }
        safeTerminalFocus(() => {
            terminalTabsRef.current?.focus()
        }, isAnyModalOpen)
    }

    // No prompt UI here anymore; moved to right panel dock

    // Render terminals as soon as we have project-scoped ids even if not ready yet
    const hasProjectScopedIds = terminals.top && !terminals.top.includes('orchestrator-default')
    const shouldRenderTerminals = isReady || hasProjectScopedIds

    // Spec sessions show placeholder instead of terminals
    if (selection.kind === 'session' && isSpec) {
        return (
            <div className="h-full p-2 relative">
                <div className="bg-panel rounded border border-slate-800 overflow-hidden min-h-0 h-full">
                    <SpecPlaceholder />
                </div>
            </div>
        )
    }

    // When collapsed, adjust sizes to show just the terminal header
    const effectiveSizes = isBottomCollapsed 
        ? [100 - collapsedPercent, collapsedPercent]
        : sizes

    // Get all running sessions for background terminals
    const dispatchOpencodeFinalResize = () => {
        try {
            if (selection.kind === 'session' && selection.payload) {
                emitUiEvent(UiEvent.OpencodeSelectionResize, { kind: 'session', sessionId: selection.payload })
            } else {
                emitUiEvent(UiEvent.OpencodeSelectionResize, { kind: 'orchestrator' })
            }
        } catch (e) {
            logger.warn('[TerminalGrid] Failed to dispatch OpenCode final resize', e)
        }
        // Also request a generic resize for the active context
        try {
            const sanitize = (s?: string | null) => (s ?? '').replace(/[^a-zA-Z0-9_-]/g, '_')
            if (selection.kind === 'session' && selection.payload) {
                emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'session', sessionId: sanitize(selection.payload) })
            } else {
                emitUiEvent(UiEvent.TerminalResizeRequest, { target: 'orchestrator' })
            }
        } catch (e) {
            logger.warn('[TerminalGrid] Failed to dispatch generic terminal resize request', e)
        }
    };

    const handlePanelTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
        const prop = e.propertyName;
        // Only react to geometry-affecting transitions
        if (prop === 'height' || prop === 'width' || prop === 'flex-basis' || prop === 'max-height') {
            dispatchOpencodeFinalResize();
        }
    };

    return (
        <div ref={containerRef} className="h-full px-2 pb-2 pt-0 relative">
            <Split 
                className="h-full flex flex-col overflow-hidden" 
                direction="vertical" 
                sizes={effectiveSizes || [72, 28]} 
                minSize={[120, isBottomCollapsed ? 44 : 24]} 
                gutterSize={8}
                onDragStart={() => {
                    document.body.classList.add('is-split-dragging')
                    setIsDraggingSplit(true)
                    isDraggingRef.current = true
                }}
                onDragEnd={(nextSizes: number[]) => {
                    setSizes(nextSizes)
                    setIsBottomCollapsed(false)
                    document.body.classList.remove('is-split-dragging')
                    window.dispatchEvent(new Event('terminal-split-drag-end'))
                    setIsDraggingSplit(false)
                    isDraggingRef.current = false
                }}
            >
                <div
                    className={`bg-panel rounded overflow-hidden min-h-0 flex flex-col border-2 ${localFocus === 'claude' ? 'border-blue-500/60 shadow-lg shadow-blue-500/20' : 'border-slate-800/50'}`}
                >
                    <div
                        className={`h-10 px-4 text-xs border-b cursor-pointer flex-shrink-0 flex items-center ${
                            localFocus === 'claude'
                                ? 'bg-blue-900/30 text-blue-200 border-blue-800/50 hover:bg-blue-900/40'
                                : 'text-slate-400 border-slate-800 hover:bg-slate-800'
                        }`}
                        onClick={handleClaudeSessionClick}
                    >
                        {/* Left side: Action Buttons - only show for orchestrator */}
                        <div className="flex items-center gap-1 pointer-events-auto">
                            {shouldShowActionButtons && (
                                <>
                                    {actionButtons.map((action) => (
                                        <button
                                            key={action.id}
                                            onClick={async (e) => {
                                                e.stopPropagation()
                                                try {
                                                    // Use the actual terminal ID from context
                                                    await invoke(TauriCommands.PasteAndSubmitTerminal, { 
                                                        id: terminals.top, 
                                                        data: action.prompt 
                                                    })
                                                    
                                                    // Restore focus to the previously focused terminal
                                                    safeTerminalFocus(() => {
                                                        if (localFocus === 'claude' && claudeTerminalRef.current) {
                                                            claudeTerminalRef.current.focus()
                                                        } else if (localFocus === 'terminal' && terminalTabsRef.current) {
                                                            terminalTabsRef.current.focus()
                                                        } else {
                                                            // Default to focusing claude terminal if no previous focus
                                                            claudeTerminalRef.current?.focus()
                                                        }
                                                    }, isAnyModalOpen)
                                                } catch (error) {
                                                    logger.error(`Failed to execute action "${action.label}":`, error)
                                                }
                                            }}
                                            className={`px-2 py-1 text-[10px] rounded flex items-center gap-1 ${getActionButtonColorClasses(action.color)}`}
                                            title={action.label}
                                        >
                                            <span>{action.label}</span>
                                        </button>
                                    ))}
                                </>
                            )}
                        </div>
                        
                        {/* Absolute-centered title to avoid alignment shift */}
                        <span className="absolute left-0 right-0 text-center font-medium pointer-events-none">
                            {selection.kind === 'orchestrator' ? 'Orchestrator — main repo' : `Agent — ${selection.payload ?? ''}`}
                        </span>
                        
                        {/* Right side: Reset (session only) + ⌘T indicator */}
                        {selection.kind === 'session' && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setConfirmResetOpen(true) }}
                                className="ml-auto mr-2 p-1 rounded hover:bg-slate-800"
                                title="Reset session"
                                aria-label="Reset session"
                            >
                                <VscDiscard className="text-base" />
                            </button>
                        )}
                        <span className={`${selection.kind === 'session' ? '' : 'ml-auto'} text-[10px] px-1.5 py-0.5 rounded ${
                            localFocus === 'claude' 
                                ? 'bg-blue-600/40 text-blue-200' 
                                : 'bg-slate-700/50 text-slate-400'
                        }`} title="Focus Claude (⌘T)">⌘T</span>
                    </div>
                    <div className={`h-[2px] flex-shrink-0 ${
                        localFocus === 'claude' && !isDraggingSplit
                            ? 'bg-gradient-to-r from-transparent via-blue-500/50 to-transparent' 
                            : 'bg-gradient-to-r from-transparent via-slate-600/30 to-transparent'
                    }`} />
                    <div className={`flex-1 min-h-0 ${localFocus === 'claude' ? 'terminal-focused-claude' : ''}`}>
                        {shouldRenderTerminals && (
                        <TerminalErrorBoundary terminalId={terminals.top}>
                            <Terminal 
                            key={`top-terminal-${terminalKey}`}
                            ref={claudeTerminalRef}
                            terminalId={terminals.top} 
                            className="h-full w-full" 
                            sessionName={selection.kind === 'session' ? selection.payload ?? undefined : undefined}
                            isCommander={selection.kind === 'orchestrator'}
                            agentType={agentType}
                            onTerminalClick={handleClaudeSessionClick}
                        />
                        </TerminalErrorBoundary>
                        )}
                    </div>
                </div>
                <div className={`bg-panel rounded ${isBottomCollapsed ? 'overflow-visible' : 'overflow-hidden'} min-h-0 flex flex-col border-2 ${localFocus === 'terminal' ? 'border-blue-500/60 shadow-lg shadow-blue-500/20' : 'border-slate-800/50'}`}>
                    <UnifiedBottomBar
                        isCollapsed={isBottomCollapsed}
                        onToggleCollapse={toggleTerminalCollapsed}
                        tabs={computedTabs}
                        activeTab={computedActiveTab}
                        isRunning={activeRunSessions.has(getSessionKey())}
                        onTabSelect={(index) => {
                            const showRunTab = hasRunScripts && runModeActive
                            if (showRunTab && index === 0) {
                                // Run tab selected - just update state to show Run tab as active
                                // The Run terminal component will be rendered instead
                                applyTabsState(prev => {
                                    const next = { ...prev, activeTab: RUN_TAB_INDEX }
                                    sessionStorage.setItem(activeTabKey, String(RUN_TAB_INDEX))
                                    return next
                                }) // Use -1 to indicate Run tab
                            } else {
                                // Terminal tab selected - adjust index if Run tab is present
                                const terminalIndex = showRunTab ? index - 1 : index
                                terminalTabsRef.current?.getTabFunctions().setActiveTab(terminalIndex)
                                applyTabsState(prev => {
                                    const next = { ...prev, activeTab: terminalIndex }
                                    sessionStorage.setItem(activeTabKey, String(terminalIndex))
                                    return next
                                })
                                safeTerminalFocus(() => {
                                    terminalTabsRef.current?.focus()
                                }, isAnyModalOpen)
                            }
                        }}
                        onTabClose={(index) => {
                            const showRunTab = hasRunScripts && runModeActive
                            // Adjust index if Run tab is present (Run tab is at index 0)
                            const terminalIndex = showRunTab ? index - 1 : index
                            
                            // Only close if it's not the Run tab (Run tab would be index 0 when present)
                            if (!(showRunTab && index === 0)) {
                                terminalTabsRef.current?.getTabFunctions().closeTab(terminalIndex)
                                // Update state to reflect the change
                                applyTabsState(prev => {
                                    const newTabs = prev.tabs.filter(tab => tab.index !== terminalIndex)
                                    return {
                                        ...prev,
                                        tabs: newTabs,
                                        activeTab: Math.max(0, prev.activeTab - (terminalIndex < prev.activeTab ? 1 : 0)),
                                        canAddTab: newTabs.length < 6 // Recalculate canAddTab based on remaining tabs
                                    }
                                })
                            }
                        }}
                        onTabAdd={() => {
                            terminalTabsRef.current?.getTabFunctions().addTab()
                            const newIndex = terminalTabsState.tabs.length
                            const newTerminalId = `${terminals.bottomBase}-${newIndex}`
                            applyTabsState(prev => ({
                                tabs: [...prev.tabs, { index: newIndex, terminalId: newTerminalId, label: `Terminal ${newIndex + 1}` }],
                                activeTab: newIndex,
                                canAddTab: prev.tabs.length + 1 < 6 // Limit to 6 terminal tabs (Run tab doesn't count)
                            }))
                        }}
                        canAddTab={terminalTabsState.canAddTab}
                        isFocused={localFocus === 'terminal'}
                        onBarClick={handleTerminalClick}
                        hasRunScripts={hasRunScripts}
                        onRunScript={() => {
                            // Toggle run script - same as Cmd+E
                            if (hasRunScripts) {
                                // If Run tab is active, toggle the run
                                if (runModeActive && terminalTabsState.activeTab === RUN_TAB_INDEX) {
                                    const sessionId = getSessionKey()
                                    const runTerminalRef = runTerminalRefs.current.get(sessionId)
                                    runTerminalRef?.toggleRun()
                                } else {
                                    // Otherwise, activate run mode and switch to Run tab
                                    const sessionKey = getSessionKey()
                                    const runModeKey = `schaltwerk:run-mode:${sessionKey}`
                                    sessionStorage.setItem(runModeKey, 'true')
                                    setRunModeActive(true)
                                    applyTabsState(prev => ({ ...prev, activeTab: RUN_TAB_INDEX }))
                                    
                                    // Expand terminal if collapsed
                                    if (isBottomCollapsed) {
                                        const expandedSize = lastExpandedBottomPercent || 28
                                        setSizes([100 - expandedSize, expandedSize])
                                        setIsBottomCollapsed(false)
                                    }
                                    
                                    // Start the run after switching
                                    // Use pendingRunToggle to trigger after RunTerminal mounts
                                    setPendingRunToggle(true)
                                }
                            }
                        }}
                    />
                    <div className={`h-[2px] flex-shrink-0 ${
                        localFocus === 'terminal' && !isDraggingSplit
                            ? 'bg-gradient-to-r from-transparent via-blue-500/50 to-transparent'
                            : 'bg-gradient-to-r from-transparent via-slate-600/30 to-transparent'
                    }`} />
                    <div className={`flex-1 min-h-0 overflow-hidden ${isBottomCollapsed ? 'hidden' : ''}`}>
                        {/* Render only the active RunTerminal; never mount for specs */}
                        {hasRunScripts && (
                            <>
                                {/* Orchestrator run terminal */}
                                {runModeActive && terminalTabsState.activeTab === RUN_TAB_INDEX && selection.kind === 'orchestrator' && (
                                    <div className="h-full w-full">
                                        <RunTerminal
                                            ref={(ref) => { if (ref) runTerminalRefs.current.set('orchestrator', ref) }}
                                            className="h-full w-full overflow-hidden"
                                            sessionName={undefined}
                                            onTerminalClick={handleTerminalClick}
                                            workingDirectory={terminals.workingDirectory}
                                            onRunningStateChange={(isRunning) => {
                                                if (isRunning) {
                                                    addRunningSession('orchestrator')
                                                    setActiveRunSessions(prev => new Set(prev).add('orchestrator'))
                                                } else {
                                                    removeRunningSession('orchestrator')
                                                    setActiveRunSessions(prev => {
                                                        const next = new Set(prev)
                                                        next.delete('orchestrator')
                                                        return next
                                                    })
                                                }
                                            }}
                                        />
                                    </div>
                                )}

                                {/* Active session run terminal (skip specs) */}
                                {runModeActive && terminalTabsState.activeTab === RUN_TAB_INDEX && selection.kind === 'session' && (() => {
                                    const active = sessions.find(s => s.info.session_id === selection.payload)
                                    if (!active) return null
                                    if (mapSessionUiState(active.info) === 'spec') return null
                                    const sessionId = active.info.session_id
                                    return (
                                        <div key={sessionId} className="h-full w-full">
                                            <RunTerminal
                                                ref={(ref) => { if (ref) runTerminalRefs.current.set(sessionId, ref) }}
                                                className="h-full w-full overflow-hidden"
                                                sessionName={sessionId}
                                                onTerminalClick={handleTerminalClick}
                                                workingDirectory={active.info.worktree_path}
                                                onRunningStateChange={(isRunning) => {
                                                    if (isRunning) {
                                                        addRunningSession(sessionId)
                                                        setActiveRunSessions(prev => new Set(prev).add(sessionId))
                                                    } else {
                                                        removeRunningSession(sessionId)
                                                        setActiveRunSessions(prev => {
                                                            const next = new Set(prev)
                                                            next.delete(sessionId)
                                                            return next
                                                        })
                                                    }
                                                }}
                                            />
                                        </div>
                                    )
                                })()}
                            </>
                        )}
                        {/* Regular terminal tabs - only show when not in run mode */}
                        {shouldRenderTerminals && (
                        <div
                            style={{ display: !hasRunScripts || !runModeActive || terminalTabsState.activeTab !== -1 ? 'block' : 'none' }}
                            className="h-full"
                            onTransitionEnd={handlePanelTransitionEnd}
                        >
                            <TerminalErrorBoundary terminalId={terminals.bottomBase}>
                                <TerminalTabs
                                    key={`terminal-tabs-${terminalKey}`}
                                    ref={terminalTabsRef}
                                    baseTerminalId={terminals.bottomBase}
                                    workingDirectory={terminals.workingDirectory}
                                    className="h-full"
                                    sessionName={selection.kind === 'session' ? selection.payload ?? undefined : undefined}
                                    isCommander={selection.kind === 'orchestrator'}
                                    agentType={agentType}
                                    onTerminalClick={handleTerminalClick}
                                    headless={true}
                                />
                            </TerminalErrorBoundary>
                        </div>
                        )}
                    </div>
                </div>
            </Split>
            <ConfirmResetDialog
                open={confirmResetOpen && selection.kind === 'session'}
                onCancel={() => setConfirmResetOpen(false)}
                onConfirm={handleConfirmReset}
                isBusy={isResetting}
            />
        </div>
    )
}
