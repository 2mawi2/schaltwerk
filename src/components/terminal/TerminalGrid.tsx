import { Terminal, TerminalHandle } from './Terminal'
import { TerminalTabs, TerminalTabsHandle } from './TerminalTabs'
import { UnifiedBottomBar } from './UnifiedBottomBar'
import { SpecPlaceholder } from '../plans/SpecPlaceholder'
import TerminalErrorBoundary from '../TerminalErrorBoundary'
import Split from 'react-split'
import { useSelection } from '../../contexts/SelectionContext'
import { useFocus } from '../../contexts/FocusContext'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { useSessions } from '../../contexts/SessionsContext'
import { AgentType } from '../../types/session'
import { useActionButtons } from '../../contexts/ActionButtonsContext'
import { invoke } from '@tauri-apps/api/core'
import { getActionButtonColorClasses } from '../../constants/actionButtonColors'
import { AnimatedText } from '../common/AnimatedText'
import { useRef, useEffect, useState } from 'react'

export function TerminalGrid() {
    const { selection, terminals, isReady, isSpec } = useSelection()
    const { getFocusForSession, setFocusForSession, currentFocus } = useFocus()
    const { getAgentType } = useClaudeSession()
    const { actionButtons } = useActionButtons()
    const { sessions } = useSessions()
    
    // Show action buttons for both orchestrator and sessions
    const shouldShowActionButtons = (selection.kind === 'orchestrator' || selection.kind === 'session') && actionButtons.length > 0
    
    const [terminalKey, setTerminalKey] = useState(0)
    const [localFocus, setLocalFocus] = useState<'claude' | 'terminal' | null>(null)
    const [agentType, setAgentType] = useState<string>('claude')
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
    const [isDraggingSplit, setIsDraggingSplit] = useState(false)
    

    const getSessionKey = () => {
        return selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown'
    }

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

        const handleFocusTerminal = (event?: Event) => {
            if (isBottomCollapsed) {
                const expandedSize = lastExpandedBottomPercent || 28
                setSizes([100 - expandedSize, expandedSize])
                setIsBottomCollapsed(false)
            }

            // Handle new focus events with specific terminal targeting
            if (event && 'detail' in event) {
                const customEvent = event as CustomEvent
                const { focusType, terminalId } = customEvent.detail
                setTimeout(() => {
                    if (focusType === 'claude' && claudeTerminalRef.current) {
                        claudeTerminalRef.current.focus()
                    } else if (focusType === 'terminal' && terminalTabsRef.current) {
                        if (terminalId) {
                            // Focus a specific terminal tab
                            terminalTabsRef.current.focusTerminal(terminalId)
                        } else {
                            // Focus the current active terminal tab
                            terminalTabsRef.current.focus()
                        }
                    }
                }, 50)
            }
        }

        window.addEventListener('schaltwerk:reset-terminals', handleTerminalReset)
        window.addEventListener('schaltwerk:focus-terminal', handleFocusTerminal)
        return () => {
            window.removeEventListener('schaltwerk:reset-terminals', handleTerminalReset)
            window.removeEventListener('schaltwerk:focus-terminal', handleFocusTerminal)
        }
    }, [isBottomCollapsed, lastExpandedBottomPercent])

    // Fetch agent type based on selection
    useEffect(() => {
        // For sessions, get the session-specific agent type
        if (selection.kind === 'session' && selection.payload) {
            const session = sessions.find(s => s.info.session_id === selection.payload)
            if (!session) {
                console.warn(`Session not found: ${selection.payload}, using default agent type`)
                setAgentType('claude')
                return
            }
            // Use session's original_agent_type if available, otherwise default to 'claude'
            // This handles existing sessions that don't have the field yet
            const sessionAgentType: AgentType = session.info.original_agent_type || 'claude'
            console.log(`Session ${selection.payload} agent type: ${sessionAgentType} (original_agent_type: ${session.info.original_agent_type})`)
            setAgentType(sessionAgentType)
        } else {
            // For orchestrator or when no session selected, use global agent type
            getAgentType().then(setAgentType).catch(error => {
                console.error('Failed to get global agent type:', error)
                // Default to 'claude' if we can't get the global agent type
                setAgentType('claude')
            })
        }
    }, [selection, sessions, getAgentType])

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
    const sessionKey = () => (selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown')
    useEffect(() => {
        const key = sessionKey()
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
        const key = sessionKey()
        sessionStorage.setItem(`schaltwerk:terminal-grid:sizes:${key}`, JSON.stringify(sizes))
        if (!isBottomCollapsed) {
            setLastExpandedBottomPercent(sizes[1])
            sessionStorage.setItem(`schaltwerk:terminal-grid:lastExpandedBottom:${key}`, String(sizes[1]))
        }
    }, [sizes, isBottomCollapsed])

    // Persist collapsed state
    useEffect(() => {
        const key = sessionKey()
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

    return (
        <div ref={containerRef} className="h-full px-2 pb-2 pt-0 relative">
            <Split 
                className="h-full flex flex-col" 
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
                                                    console.error(`Failed to execute action "${action.label}":`, error)
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
                        tabs={terminalTabsState.tabs}
                        activeTab={terminalTabsState.activeTab}
                        onTabSelect={(index) => {
                            terminalTabsRef.current?.getTabFunctions().setActiveTab(index)
                            setTerminalTabsState(prev => ({ ...prev, activeTab: index }))
                            requestAnimationFrame(() => {
                                terminalTabsRef.current?.focus()
                            })
                        }}
                        onTabClose={(index) => {
                            terminalTabsRef.current?.getTabFunctions().closeTab(index)
                            // Update state to reflect the change - simplified logic for now
                            setTerminalTabsState(prev => ({
                                ...prev,
                                tabs: prev.tabs.filter(tab => tab.index !== index),
                                activeTab: Math.max(0, prev.activeTab - (index < prev.activeTab ? 1 : 0))
                            }))
                        }}
                        onTabAdd={() => {
                            terminalTabsRef.current?.getTabFunctions().addTab()
                            const newIndex = terminalTabsState.tabs.length
                            const newTerminalId = `${terminals.bottomBase}-${newIndex}`
                            setTerminalTabsState(prev => ({
                                tabs: [...prev.tabs, { index: newIndex, terminalId: newTerminalId, label: `Terminal ${newIndex + 1}` }],
                                activeTab: newIndex,
                                canAddTab: prev.tabs.length + 1 < 6
                            }))
                        }}
                        canAddTab={terminalTabsState.canAddTab}
                        isFocused={localFocus === 'terminal'}
                        onBarClick={handleTerminalClick}
                    />
                    <div className={`h-[2px] flex-shrink-0 ${isDraggingSplit ? '' : 'transition-opacity duration-200'} ${
                        localFocus === 'terminal' && !isDraggingSplit
                            ? 'bg-gradient-to-r from-transparent via-blue-500/50 to-transparent'
                            : 'bg-gradient-to-r from-transparent via-slate-600/30 to-transparent'
                    }`} />
                    <div className={`flex-1 min-h-0 ${isBottomCollapsed ? 'hidden' : ''}`}>
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
            </Split>
        </div>
    )
}