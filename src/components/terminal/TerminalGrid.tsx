import { Terminal, TerminalHandle } from './Terminal'
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
import { AnimatedText } from '../common/AnimatedText'
import { useRef, useEffect, useState, useMemo } from 'react'
import { logger } from '../../utils/logger'
import { loadRunScriptConfiguration } from '../../utils/runScriptLoader'

export function TerminalGrid() {
    const { selection, terminals, isReady, isSpec } = useSelection()
    const { getFocusForSession, setFocusForSession, currentFocus } = useFocus()
    const { addRunningSession, removeRunningSession, isSessionRunning } = useRun()
    const { getAgentType } = useClaudeSession()
    const { actionButtons } = useActionButtons()
    const { sessions } = useSessions()
    
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
    
    const [terminalTabsState, setTerminalTabsState] = useState<{
        tabs: Array<{ index: number; terminalId: string; label: string }>
        activeTab: number
        canAddTab: boolean
    }>({
        tabs: [{ index: 0, terminalId: terminals.bottomBase, label: 'Terminal 1' }],
        activeTab: 0,
        canAddTab: true
    })
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
    
    // Run Mode state
    const [hasRunScripts, setHasRunScripts] = useState(false)
    const [runModeActive, setRunModeActive] = useState(false)
    const [activeRunSessions, setActiveRunSessions] = useState<Set<string>>(new Set())
    const [pendingRunToggle, setPendingRunToggle] = useState(false)
    

    const getSessionKey = () => {
        return sessionKey
    }

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
    }, [hasRunScripts, runModeActive, terminalTabsState.activeTab])

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
        const handleTerminalReset = () => {
            setTerminalKey(prev => prev + 1)
        }

        const handleFocusTerminal = () => {
            // Expand if collapsed
            if (isBottomCollapsed) {
                const expandedSize = lastExpandedBottomPercent || 28
                setSizes([100 - expandedSize, expandedSize])
                setIsBottomCollapsed(false)
            }
            
            // Focus the terminal using requestAnimationFrame for next render
            requestAnimationFrame(() => {
                terminalTabsRef.current?.focus()
            })
        }

        window.addEventListener('schaltwerk:reset-terminals', handleTerminalReset)
        window.addEventListener('schaltwerk:focus-terminal', handleFocusTerminal)
        return () => {
            window.removeEventListener('schaltwerk:reset-terminals', handleTerminalReset)
            window.removeEventListener('schaltwerk:focus-terminal', handleFocusTerminal)
        }
    }, [isBottomCollapsed, lastExpandedBottomPercent, runModeActive, terminalTabsState.activeTab])

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
            const sessionAgentType: AgentType = session.info.original_agent_type || 'claude'
            logger.info(`Session ${selection.payload} agent type: ${sessionAgentType} (original_agent_type: ${session.info.original_agent_type})`)
            setAgentType(sessionAgentType)
        } else {
            // For orchestrator or when no session selected, use global agent type
            getAgentType().then(setAgentType).catch(error => {
                logger.error('Failed to get global agent type:', error)
                // Default to 'claude' if we can't get the global agent type
                setAgentType('claude')
            })
        }
    }, [selection, sessions, getAgentType])

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
                setTerminalTabsState(prev => ({ ...prev, activeTab: savedTab }))
            }
        }
        
        initializeRunMode()
    }, [selection])

    // Focus appropriate terminal when selection changes
    useEffect(() => {
        if (!selection) return
        
        const sessionKey = getSessionKey()
        const focusArea = getFocusForSession(sessionKey)
        setLocalFocus(focusArea === 'claude' || focusArea === 'terminal' ? focusArea : null)
        
        // Focus the appropriate terminal after ensuring it's rendered
        requestAnimationFrame(() => {
            if (focusArea === 'claude' && claudeTerminalRef.current) {
                claudeTerminalRef.current.focus()
            } else if (focusArea === 'terminal' && terminalTabsRef.current) {
                terminalTabsRef.current.focus()
            }
            // TODO: Add diff focus handling when we implement it
        })
    }, [selection, getFocusForSession])

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

        // Apply the new global focus
        if (currentFocus === 'claude') {
            setLocalFocus('claude')
            claudeTerminalRef.current?.focus()
            lastAppliedGlobalFocusRef.current = 'claude'
        } else if (currentFocus === 'terminal') {
            setLocalFocus('terminal')
            terminalTabsRef.current?.focus()
            lastAppliedGlobalFocusRef.current = 'terminal'
        } else {
            setLocalFocus(null)
            lastAppliedGlobalFocusRef.current = null
        }
    }, [currentFocus, selection])

    // Keyboard shortcut handling for Run Mode (Cmd+E)
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Cmd+E (Mac) or Ctrl+E (Windows/Linux) for Run Mode Toggle
            if ((event.metaKey || event.ctrlKey) && event.key === 'e') {
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
                        setTerminalTabsState(prev => {
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
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [hasRunScripts, isBottomCollapsed, lastExpandedBottomPercent, runModeActive, terminalTabsState.activeTab, sessionKey])

    // Handle pending run toggle after RunTerminal mounts
    useEffect(() => {
        if (!pendingRunToggle) return
        
        // Check if we're on the Run tab
        if (runModeActive && terminalTabsState.activeTab === RUN_TAB_INDEX) {
            const sessionId = getSessionKey()
            const runTerminalRef = runTerminalRefs.current.get(sessionId)
            
            if (runTerminalRef) {
                // RunTerminal is ready, toggle it
                runTerminalRef.toggleRun()
                setPendingRunToggle(false)
            }
            // If ref not ready yet, effect will re-run when ref changes
        }
    }, [pendingRunToggle, runModeActive, terminalTabsState.activeTab])

    // Compute collapsed percent based on actual header height and container size
    useEffect(() => {
        if (!isBottomCollapsed) return
        const computeCollapsedPercent = () => {
            const container = containerRef.current
            if (!container) return
            const total = container.clientHeight
            if (total <= 0) return
            const headerEl = container.querySelector('[data-bottom-header]') as HTMLElement | null
            const headerHeight = headerEl?.offsetHeight || 40
            // Ensure minimum 40px for the header bar (including borders)
            const minPixels = 44 // 40px header + 2px border + 2px gradient line
            const minPct = (minPixels / total) * 100
            const pct = Math.max(minPct, Math.min(15, (headerHeight / total) * 100))
            // Only update if significantly different to avoid cascading resizes
            if (Math.abs(pct - collapsedPercent) > 1.0) {
                setCollapsedPercent(pct)
                // Use requestAnimationFrame to avoid mid-frame updates
                requestAnimationFrame(() => {
                    setSizes([100 - pct, pct])
                })
            }
        }
        // Initial computation with delay to ensure layout is stable
        const timer = setTimeout(computeCollapsedPercent, 50)
        const ro = new ResizeObserver(() => {
            // Debounce resize observations to avoid too frequent updates
            clearTimeout(timer)
            setTimeout(computeCollapsedPercent, 100)
        })
        if (containerRef.current) ro.observe(containerRef.current)
        return () => {
            clearTimeout(timer)
            ro.disconnect()
        }
    }, [isBottomCollapsed])

    // Load sizes/collapse state when selection changes (avoid unnecessary updates)
    const getStorageKey = () => (selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown')
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
    }, [sizes, isBottomCollapsed])

    // Persist collapsed state
    useEffect(() => {
        const key = getStorageKey()
        sessionStorage.setItem(`schaltwerk:terminal-grid:collapsed:${key}`, String(isBottomCollapsed))
    }, [isBottomCollapsed, selection])

    // Initialize terminal tabs state when terminals change
    useEffect(() => {
        setTerminalTabsState({
            tabs: [{ index: 0, terminalId: terminals.bottomBase, label: 'Terminal 1' }],
            activeTab: 0,
            canAddTab: true
        })
    }, [terminalKey, terminals.bottomBase])

    const handleClaudeSessionClick = async (e?: React.MouseEvent) => {
        // Prevent event from bubbling if called from child
        e?.stopPropagation()
        
        const sessionKey = getSessionKey()
        setFocusForSession(sessionKey, 'claude')
        setLocalFocus('claude')
        
        // Only focus the terminal, don't restart Claude
        // Claude is already auto-started by the Terminal component when first mounted
        // Use requestAnimationFrame for more reliable focus
        requestAnimationFrame(() => {
            claudeTerminalRef.current?.focus()
        })
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
            requestAnimationFrame(() => {
                terminalTabsRef.current?.focus()
            })
            return
        }
        requestAnimationFrame(() => {
            terminalTabsRef.current?.focus()
        })
    }

    // No prompt UI here anymore; moved to right panel dock

    // Don't render terminals until selection is ready
    if (!isReady) {
        return (
            <div className="h-full p-2 relative flex items-center justify-center">
                <AnimatedText text="loading" colorClassName="text-slate-500" size="md" speedMultiplier={3} />
            </div>
        )
    }

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
    const runningSessionsList = sessions.filter(s => s.info.session_state === 'running')
    const currentSessionId = selection.kind === 'session' ? selection.payload : null
    const backgroundSessions = runningSessionsList.filter(s => s.info.session_id !== currentSessionId)

    return (
        <div ref={containerRef} className="h-full px-2 pb-2 pt-0 relative">
            {/* Background terminals for all non-active running sessions */}
            {backgroundSessions.map(session => {
                const sessionName = session.info.session_id
                const sanitizedSessionName = sessionName.replace(/[^a-zA-Z0-9_-]/g, '_')
                const topTerminalId = `session-${sanitizedSessionName}-top`
                const bottomTerminalId = `session-${sanitizedSessionName}-bottom`
                
                return (
                    <div key={`background-${sessionName}`} style={{ display: 'none' }}>
                        <TerminalErrorBoundary terminalId={topTerminalId}>
                            <Terminal
                                terminalId={topTerminalId}
                                className="h-full w-full"
                                sessionName={sessionName}
                                isCommander={false}
                                agentType={session.info.original_agent_type || 'claude'}
                                isBackground={true}
                            />
                        </TerminalErrorBoundary>
                        <TerminalErrorBoundary terminalId={bottomTerminalId}>
                            <Terminal
                                terminalId={bottomTerminalId}
                                className="h-full w-full"
                                sessionName={sessionName}
                                isCommander={false}
                                agentType={session.info.original_agent_type || 'claude'}
                                isBackground={true}
                            />
                        </TerminalErrorBoundary>
                    </div>
                )
            })}
            
            <Split 
                className="h-full flex flex-col overflow-hidden" 
                direction="vertical" 
                sizes={effectiveSizes || [72, 28]} 
                minSize={[120, isBottomCollapsed ? 44 : 24]} 
                gutterSize={8}
                onDragStart={() => {
                    document.body.classList.add('is-split-dragging')
                    setIsDraggingSplit(true)
                }}
                onDragEnd={(nextSizes: number[]) => {
                    setSizes(nextSizes)
                    setIsBottomCollapsed(false)
                    document.body.classList.remove('is-split-dragging')
                    window.dispatchEvent(new Event('terminal-split-drag-end'))
                    setIsDraggingSplit(false)
                }}
            >
                <div className={`bg-panel rounded overflow-hidden min-h-0 flex flex-col border-2 ${isDraggingSplit ? '' : 'transition-all duration-200'} ${localFocus === 'claude' && !isDraggingSplit ? 'border-blue-500/60 shadow-lg shadow-blue-500/20' : 'border-slate-800/50'}`}>
                    <div
                        className={`h-10 px-4 text-xs border-b cursor-pointer flex-shrink-0 flex items-center ${isDraggingSplit ? '' : 'transition-colors duration-200'} ${
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
                                                    await invoke('paste_and_submit_terminal', { 
                                                        id: terminals.top, 
                                                        data: action.prompt 
                                                    })
                                                    
                                                    // Restore focus to the previously focused terminal
                                                    requestAnimationFrame(() => {
                                                        if (localFocus === 'claude' && claudeTerminalRef.current) {
                                                            claudeTerminalRef.current.focus()
                                                        } else if (localFocus === 'terminal' && terminalTabsRef.current) {
                                                            terminalTabsRef.current.focus()
                                                        } else {
                                                            // Default to focusing claude terminal if no previous focus
                                                            claudeTerminalRef.current?.focus()
                                                        }
                                                    })
                                                } catch (error) {
                                                    logger.error(`Failed to execute action "${action.label}":`, error)
                                                }
                                            }}
                                            className={`px-2 py-1 text-[10px] rounded transition-colors flex items-center gap-1 ${getActionButtonColorClasses(action.color)}`}
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
                        
                        {/* Right side: ⌘T indicator */}
                        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded transition-colors duration-200 ${
                            localFocus === 'claude' 
                                ? 'bg-blue-600/40 text-blue-200' 
                                : 'bg-slate-700/50 text-slate-400'
                        }`} title="Focus Claude (⌘T)">⌘T</span>
                    </div>
                    <div className={`h-[2px] flex-shrink-0 ${isDraggingSplit ? '' : 'transition-opacity duration-200'} ${
                        localFocus === 'claude' && !isDraggingSplit
                            ? 'bg-gradient-to-r from-transparent via-blue-500/50 to-transparent' 
                            : 'bg-gradient-to-r from-transparent via-slate-600/30 to-transparent'
                    }`} />
                    <div className={`flex-1 min-h-0 ${localFocus === 'claude' ? 'terminal-focused-claude' : ''}`}>
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
                    </div>
                </div>
                <div className={`bg-panel rounded ${isBottomCollapsed ? 'overflow-visible' : 'overflow-hidden'} min-h-0 flex flex-col border-2 ${isDraggingSplit ? '' : 'transition-all duration-200'} ${localFocus === 'terminal' && !isDraggingSplit ? 'border-blue-500/60 shadow-lg shadow-blue-500/20' : 'border-slate-800/50'}`}>
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
                                setTerminalTabsState(prev => {
                                    const next = { ...prev, activeTab: RUN_TAB_INDEX }
                                    sessionStorage.setItem(activeTabKey, String(RUN_TAB_INDEX))
                                    return next
                                }) // Use -1 to indicate Run tab
                            } else {
                                // Terminal tab selected - adjust index if Run tab is present
                                const terminalIndex = showRunTab ? index - 1 : index
                                terminalTabsRef.current?.getTabFunctions().setActiveTab(terminalIndex)
                                setTerminalTabsState(prev => {
                                    const next = { ...prev, activeTab: terminalIndex }
                                    sessionStorage.setItem(activeTabKey, String(terminalIndex))
                                    return next
                                })
                                requestAnimationFrame(() => {
                                    terminalTabsRef.current?.focus()
                                })
                                // Stop run if switching away from Run tab
                                const currentSessionId = selection.kind === 'session' ? selection.payload : 'orchestrator'
                                if (currentSessionId && isSessionRunning(currentSessionId)) {
                                    const runTerminalRef = runTerminalRefs.current.get(currentSessionId)
                                    runTerminalRef?.toggleRun()
                                }
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
                                setTerminalTabsState(prev => ({
                                    ...prev,
                                    tabs: prev.tabs.filter(tab => tab.index !== terminalIndex),
                                    activeTab: Math.max(0, prev.activeTab - (terminalIndex < prev.activeTab ? 1 : 0))
                                }))
                            }
                        }}
                        onTabAdd={() => {
                            terminalTabsRef.current?.getTabFunctions().addTab()
                            const newIndex = terminalTabsState.tabs.length
                            const newTerminalId = `${terminals.bottomBase}-${newIndex}`
                            setTerminalTabsState(prev => ({
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
                                    setTerminalTabsState(prev => ({ ...prev, activeTab: RUN_TAB_INDEX }))
                                    
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
                        onConfigureRun={() => {
                            // Open settings modal to run scripts category
                            // This will need to be implemented with a settings modal context
                            console.log('Configure run scripts - open settings modal')
                        }}
                    />
                    <div className={`h-[2px] flex-shrink-0 ${isDraggingSplit ? '' : 'transition-opacity duration-200'} ${
                        localFocus === 'terminal' && !isDraggingSplit
                            ? 'bg-gradient-to-r from-transparent via-blue-500/50 to-transparent'
                            : 'bg-gradient-to-r from-transparent via-slate-600/30 to-transparent'
                    }`} />
                    <div className={`flex-1 min-h-0 overflow-hidden ${isBottomCollapsed ? 'hidden' : ''}`}>
                        {/* Render all run terminals but only show the active one */}
                        {hasRunScripts && (
                            <>
                                {/* Orchestrator run terminal */}
                                <div style={{ display: runModeActive && terminalTabsState.activeTab === RUN_TAB_INDEX && selection.kind === 'orchestrator' ? 'block' : 'none' }} className="h-full w-full">
                                    <RunTerminal
                                        ref={(ref) => {
                                            if (ref) runTerminalRefs.current.set('orchestrator', ref)
                                        }}
                                        className="h-full w-full overflow-hidden"
                                        sessionName={undefined}
                                        isCommander={true}
                                        onTerminalClick={handleTerminalClick}
                                        workingDirectory={selection.kind === 'orchestrator' ? terminals.workingDirectory : ''}
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
                                {/* Session run terminals */}
                                {sessions.map(session => {
                                    const sessionId = session.info.session_id
                                    const isActiveRunTerminal = runModeActive && terminalTabsState.activeTab === RUN_TAB_INDEX && selection.kind === 'session' && selection.payload === sessionId
                                    return (
                                        <div key={sessionId} style={{ display: isActiveRunTerminal ? 'block' : 'none' }} className="h-full w-full">
                                            <RunTerminal
                                                ref={(ref) => {
                                                    if (ref) runTerminalRefs.current.set(sessionId, ref)
                                                }}
                                                className="h-full w-full overflow-hidden"
                                                sessionName={sessionId}
                                                isCommander={false}
                                                onTerminalClick={handleTerminalClick}
                                                workingDirectory={session.info.worktree_path}
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
                                })}
                            </>
                        )}
                        {/* Regular terminal tabs - only show when not in run mode */}
                        <div style={{ display: !hasRunScripts || !runModeActive || terminalTabsState.activeTab !== -1 ? 'block' : 'none' }} className="h-full">
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
                    </div>
                </div>
            </Split>
        </div>
    )
}