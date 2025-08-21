import { Terminal, TerminalHandle } from './Terminal'
import { TerminalTabs, TerminalTabsHandle } from './TerminalTabs'
import { DraftPlaceholder } from '../drafts/DraftPlaceholder'
import Split from 'react-split'
import { VscChevronDown, VscChevronUp } from 'react-icons/vsc'
import { useSelection } from '../../contexts/SelectionContext'
import { useFocus } from '../../contexts/FocusContext'
import { useRef, useEffect, useState } from 'react'

export function TerminalGrid() {
    const { selection, terminals, isReady, isDraft } = useSelection()
    const { getFocusForSession, setFocusForSession, currentFocus } = useFocus()
    const [terminalKey, setTerminalKey] = useState(0)
    const [localFocus, setLocalFocus] = useState<'claude' | 'terminal' | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [collapsedPercent, setCollapsedPercent] = useState<number>(6) // fallback ~ header height in %
    // Initialize persisted UI state synchronously to avoid extra re-renders that remount children in tests
    const initialPersistKey = selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown'
    const initialIsCollapsed = (localStorage.getItem(`schaltwerk:terminal-grid:collapsed:${initialPersistKey}`) === 'true')
    const initialExpanded = (() => {
        const rawExpanded = localStorage.getItem(`schaltwerk:terminal-grid:lastExpandedBottom:${initialPersistKey}`)
        const v = rawExpanded ? Number(rawExpanded) : NaN
        return !Number.isNaN(v) && v > 0 && v < 100 ? v : 35
    })()
    const [isBottomCollapsed, setIsBottomCollapsed] = useState<boolean>(initialIsCollapsed)
    const [lastExpandedBottomPercent, setLastExpandedBottomPercent] = useState<number>(initialExpanded)
    const [sizes, setSizes] = useState<number[]>(() => {
        const raw = localStorage.getItem(`schaltwerk:terminal-grid:sizes:${initialPersistKey}`)
        let base: number[] = [65, 35]
        if (raw) {
            try { const parsed = JSON.parse(raw) as number[]; if (Array.isArray(parsed) && parsed.length === 2) base = parsed } catch {}
        }
        if (initialIsCollapsed) {
            const pct = 6
            return [100 - pct, pct]
        }
        return base
    })
    
    const claudeTerminalRef = useRef<TerminalHandle>(null)
    const terminalTabsRef = useRef<TerminalTabsHandle>(null)
    const bottomTerminalRef = useRef<TerminalHandle>(null)
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
            const expandedSize = lastExpandedBottomPercent || 35
            setSizes([100 - expandedSize, expandedSize])
        }
    }
    
    // Listen for terminal reset events and focus terminal events
    useEffect(() => {
        const handleTerminalReset = () => {
            setTerminalKey(prev => prev + 1)
        }
        
        const handleFocusTerminal = () => {
            if (isBottomCollapsed) {
                const expandedSize = lastExpandedBottomPercent || 35
                setSizes([100 - expandedSize, expandedSize])
                setIsBottomCollapsed(false)
            }
        }
        
        window.addEventListener('schaltwerk:reset-terminals', handleTerminalReset)
        window.addEventListener('schaltwerk:focus-terminal', handleFocusTerminal)
        return () => {
            window.removeEventListener('schaltwerk:reset-terminals', handleTerminalReset)
            window.removeEventListener('schaltwerk:focus-terminal', handleFocusTerminal)
        }
    }, [isBottomCollapsed, lastExpandedBottomPercent])

    // Focus appropriate terminal when selection changes
    useEffect(() => {
        if (!selection) return
        
        const sessionKey = getSessionKey()
        const focusArea = getFocusForSession(sessionKey)
        setLocalFocus(focusArea === 'claude' || focusArea === 'terminal' ? focusArea : null)
        
        // Focus the appropriate terminal after a short delay to ensure it's rendered
        setTimeout(() => {
            if (focusArea === 'claude' && claudeTerminalRef.current) {
                claudeTerminalRef.current.focus()
            } else if (focusArea === 'terminal') {
                if (selection.kind === 'orchestrator' && terminalTabsRef.current) {
                    terminalTabsRef.current.focus()
                } else if (selection.kind === 'session' && bottomTerminalRef.current) {
                    bottomTerminalRef.current.focus()
                }
            }
            // TODO: Add diff focus handling when we implement it
        }, 150)
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
            if (selection.kind === 'orchestrator') {
                terminalTabsRef.current?.focus()
            } else {
                bottomTerminalRef.current?.focus()
            }
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
            const headerHeight = headerEl?.offsetHeight || 30
            const pct = Math.max(2, Math.min(15, (headerHeight / total) * 100))
            if (Math.abs(pct - collapsedPercent) > 0.5) {
                setCollapsedPercent(pct)
                setSizes([100 - pct, pct])
            }
        }
        computeCollapsedPercent()
        const ro = new ResizeObserver(computeCollapsedPercent)
        if (containerRef.current) ro.observe(containerRef.current)
        return () => ro.disconnect()
    }, [isBottomCollapsed, collapsedPercent])

    // Load sizes/collapse state when selection changes (avoid unnecessary updates)
    const sessionKey = () => (selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown')
    useEffect(() => {
        const key = sessionKey()
        const raw = localStorage.getItem(`schaltwerk:terminal-grid:sizes:${key}`)
        const rawCollapsed = localStorage.getItem(`schaltwerk:terminal-grid:collapsed:${key}`)
        const rawExpanded = localStorage.getItem(`schaltwerk:terminal-grid:lastExpandedBottom:${key}`)
        let nextSizes: number[] = [65, 35]
        let expandedBottom = 35
        
        if (raw) {
            try { const parsed = JSON.parse(raw) as number[]; if (Array.isArray(parsed) && parsed.length === 2) nextSizes = parsed } catch {}
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
        localStorage.setItem(`schaltwerk:terminal-grid:sizes:${key}`, JSON.stringify(sizes))
        if (!isBottomCollapsed) {
            setLastExpandedBottomPercent(sizes[1])
            localStorage.setItem(`schaltwerk:terminal-grid:lastExpandedBottom:${key}`, String(sizes[1]))
        }
    }, [sizes, isBottomCollapsed])

    // Persist collapsed state
    useEffect(() => {
        const key = sessionKey()
        localStorage.setItem(`schaltwerk:terminal-grid:collapsed:${key}`, String(isBottomCollapsed))
    }, [isBottomCollapsed, selection])

    const handleClaudeSessionClick = async () => {
        const sessionKey = getSessionKey()
        setFocusForSession(sessionKey, 'claude')
        setLocalFocus('claude')
        
        // Only focus the terminal, don't restart Claude
        // Claude is already auto-started by the Terminal component when first mounted
        setTimeout(() => {
            claudeTerminalRef.current?.focus()
        }, 100)
    }

    const handleTerminalClick = () => {
        const sessionKey = getSessionKey()
        setFocusForSession(sessionKey, 'terminal')
        setLocalFocus('terminal')
        // If collapsed, uncollapse first
        if (isBottomCollapsed) {
            const expanded = lastExpandedBottomPercent || 35
            setSizes([100 - expanded, expanded])
            setIsBottomCollapsed(false)
            setTimeout(() => {
                if (selection.kind === 'orchestrator') {
                    terminalTabsRef.current?.focus()
                } else {
                    bottomTerminalRef.current?.focus()
                }
            }, 120)
            return
        }
        setTimeout(() => {
            if (selection.kind === 'orchestrator') {
                terminalTabsRef.current?.focus()
            } else {
                bottomTerminalRef.current?.focus()
            }
        }, 100)
    }


    // No prompt UI here anymore; moved to right panel dock

    // Don't render terminals until selection is ready
    if (!isReady) {
        return (
            <div className="h-full p-2 relative flex items-center justify-center">
                <div className="text-slate-500 text-sm">Initializing terminals...</div>
            </div>
        )
    }

    // Draft sessions show placeholder instead of terminals
    if (selection.kind === 'session' && isDraft) {
        return (
            <div className="h-full p-2 relative">
                <div className="bg-panel rounded border border-slate-800 overflow-hidden min-h-0 h-full">
                    <DraftPlaceholder />
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
                sizes={effectiveSizes || [65, 35]} 
                minSize={[120, 24]} 
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
                <div className={`bg-panel rounded overflow-hidden min-h-0 flex flex-col ${isDraggingSplit ? '' : 'transition-all duration-200'} ${localFocus === 'claude' && !isDraggingSplit ? 'border-2 border-blue-500/60 shadow-lg shadow-blue-500/20' : 'border border-slate-800'}`}>
                    <div 
                        className={`h-8 px-3 text-xs border-b cursor-pointer flex-shrink-0 flex items-center ${isDraggingSplit ? '' : 'transition-colors duration-200'} ${
                            localFocus === 'claude' 
                                ? 'bg-blue-900/30 text-blue-200 border-blue-800/50 hover:bg-blue-900/40' 
                                : 'text-slate-400 border-slate-800 hover:bg-slate-800'
                        }`}
                        onClick={handleClaudeSessionClick}
                    >
                        {/* Absolute-centered title to avoid alignment shift */}
                        <span className="absolute left-0 right-0 text-center font-medium pointer-events-none">
                            {selection.kind === 'orchestrator' ? 'Orchestrator — main repo' : `Session — ${selection.payload ?? ''}`}
                        </span>
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
                    <div className={`flex-1 min-h-0 ${localFocus === 'claude' ? 'terminal-focused-claude' : ''}`} onClick={handleClaudeSessionClick}>
                        <Terminal 
                            key={`top-terminal-${terminalKey}`}
                            ref={claudeTerminalRef}
                            terminalId={terminals.top} 
                            className="h-full w-full" 
                            sessionName={selection.kind === 'session' ? selection.payload ?? undefined : undefined}
                            isOrchestrator={selection.kind === 'orchestrator'}
                        />
                    </div>
                </div>
                <div className={`bg-panel rounded overflow-hidden min-h-0 flex flex-col ${isDraggingSplit ? '' : 'transition-all duration-200'} ${localFocus === 'terminal' && !isDraggingSplit ? 'border-2 border-blue-500/60 shadow-lg shadow-blue-500/20' : 'border border-slate-800'}`}>
                    <div 
                        data-bottom-header
                        className={`h-8 px-3 text-xs border-b cursor-pointer flex-shrink-0 flex items-center ${isDraggingSplit ? '' : 'transition-colors duration-200'} ${
                            localFocus === 'terminal'
                                ? 'bg-blue-900/30 text-blue-200 border-blue-800/50 hover:bg-blue-900/40'
                                : 'text-slate-400 border-slate-800 hover:bg-slate-800'
                        }`}
                        onClick={handleTerminalClick}
                    >
                        <span className="absolute left-0 right-0 text-center pointer-events-none">
                            Terminal — {selection.kind === 'orchestrator' ? 'main' : selection.payload}
                        </span>
                        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded mr-1 transition-colors duration-200 ${
                            localFocus === 'terminal'
                                ? 'bg-blue-600/40 text-blue-200'
                                : 'bg-slate-700/50 text-slate-400'
                        }`} title="Focus Terminal (⌘/)">⌘/</span>
                        <button
                            onClick={toggleTerminalCollapsed}
                            title={isBottomCollapsed ? 'Expand terminal panel' : 'Collapse terminal panel'}
                            className={`w-7 h-7 ml-1 flex items-center justify-center rounded transition-colors ${
                                localFocus === 'terminal'
                                    ? 'hover:bg-blue-600/50 text-blue-200 hover:text-blue-100'
                                    : 'hover:bg-slate-700/50 text-slate-300 hover:text-slate-100'
                            }`}
                            aria-label={isBottomCollapsed ? 'Expand terminal panel' : 'Collapse terminal panel'}
                        >
                            {isBottomCollapsed ? (
                                <VscChevronUp size={16} />
                            ) : (
                                <VscChevronDown size={16} />
                            )}
                        </button>
                    </div>
                    <div className={`h-[2px] flex-shrink-0 ${isDraggingSplit ? '' : 'transition-opacity duration-200'} ${
                        localFocus === 'terminal' && !isDraggingSplit
                            ? 'bg-gradient-to-r from-transparent via-blue-500/50 to-transparent'
                            : 'bg-gradient-to-r from-transparent via-slate-600/30 to-transparent'
                    }`} />
                    <div className={`flex-1 min-h-0 ${isBottomCollapsed ? 'hidden' : ''}`} onClick={handleTerminalClick}>
                        {selection.kind === 'orchestrator' ? (
                            <TerminalTabs
                                key={`terminal-tabs-${terminalKey}`}
                                ref={terminalTabsRef}
                                baseTerminalId={terminals.bottomBase}
                                workingDirectory={terminals.workingDirectory}
                                className="h-full"
                                sessionName={undefined}
                                isOrchestrator={true}
                            />
                        ) : (
                            <Terminal
                                key={`bottom-terminal-${terminalKey}`}
                                ref={bottomTerminalRef}
                                terminalId={terminals.bottomBase}
                                className="h-full w-full"
                                sessionName={selection.payload ?? undefined}
                                isOrchestrator={false}
                            />
                        )}
                    </div>
                </div>
            </Split>

            {/* Prompt dock moved to right diff panel */}
        </div>
    )
}