import { Terminal, TerminalHandle } from './Terminal'
import { TerminalTabs, TerminalTabsHandle } from './TerminalTabs'
import { DraftPlaceholder } from '../drafts/DraftPlaceholder'
import Split from 'react-split'
import { VscChevronDown, VscChevronUp } from 'react-icons/vsc'
import { useSelection } from '../../contexts/SelectionContext'
import { useFocus } from '../../contexts/FocusContext'
import { useTerminalUIPreferences } from '../../hooks/useTerminalUIPreferences'
import { useRef, useEffect, useState } from 'react'

export function TerminalGrid() {
    const { selection, terminals, isReady, isDraft } = useSelection()
    const { getFocusForSession, setFocusForSession, currentFocus } = useFocus()
    const { isCollapsed, setCollapsed } = useTerminalUIPreferences()
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
    const [isDraggingSplit, setIsDraggingSplit] = useState(false)
    

    const getSessionKey = () => {
        return selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown'
    }

    const toggleTerminalCollapsed = () => {
        setIsBottomCollapsed(!isBottomCollapsed)
    }
    
    // Listen for terminal reset events
    useEffect(() => {
        const handleTerminalReset = () => {
            setTerminalKey(prev => prev + 1)
        }
        
        window.addEventListener('schaltwerk:reset-terminals', handleTerminalReset)
        return () => window.removeEventListener('schaltwerk:reset-terminals', handleTerminalReset)
    }, [])

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
            } else if (focusArea === 'terminal' && terminalTabsRef.current) {
                terminalTabsRef.current.focus()
            }
            // TODO: Add diff focus handling when we implement it
        }, 150)
    }, [selection, getFocusForSession])

    // If global focus changes to claude/terminal, apply it immediately
    useEffect(() => {
        if (!selection || !currentFocus) return
        if (currentFocus === 'claude') {
            setLocalFocus('claude')
            claudeTerminalRef.current?.focus()
        } else if (currentFocus === 'terminal') {
            setLocalFocus('terminal')
            terminalTabsRef.current?.focus()
        } else {
            setLocalFocus(null)
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

    // Load sizes when selection changes (avoid unnecessary updates)
    const sessionKey = () => (selection.kind === 'orchestrator' ? 'orchestrator' : selection.payload || 'unknown')
    useEffect(() => {
        const key = sessionKey()
        const raw = localStorage.getItem(`schaltwerk:terminal-grid:sizes:${key}`)
        const rawExpanded = localStorage.getItem(`schaltwerk:terminal-grid:lastExpandedBottom:${key}`)
        let nextSizes: number[] = [65, 35]
        let expandedBottom = 35
        if (raw) {
            try { const parsed = JSON.parse(raw) as number[]; if (Array.isArray(parsed) && parsed.length === 2) nextSizes = parsed } catch {}
        }
        if (rawExpanded) { const v = Number(rawExpanded); if (!Number.isNaN(v) && v > 0 && v < 100) expandedBottom = v }
        setLastExpandedBottomPercent(expandedBottom)
        if (isBottomCollapsed) {
            const pct = collapsedPercent
            const target = [100 - pct, pct]
            if (sizes[0] !== target[0] || sizes[1] !== target[1]) setSizes(target)
        } else {
            if (sizes[0] !== nextSizes[0] || sizes[1] !== nextSizes[1]) setSizes(nextSizes)
        }
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

    // Persist collapsed state (kept for backward compatibility; no longer read per-session)
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
            setTimeout(() => terminalTabsRef.current?.focus(), 120)
            return
        }
        setTimeout(() => {
            terminalTabsRef.current?.focus()
        }, 100)
    }

    // Keep the bottom split's collapsed state consistent when switching sessions while minimized globally
    useEffect(() => {
        if (!isCollapsed) return
        if (!isBottomCollapsed) setIsBottomCollapsed(true)
    }, [isCollapsed])

    // Open the entire terminal section when a global show event is dispatched (e.g., Cmd+/)
    useEffect(() => {
        const handler = async () => {
            try { await setCollapsed(false) } catch {}
        }
        window.addEventListener('schaltwerk:show-terminal', handler)
        return () => window.removeEventListener('schaltwerk:show-terminal', handler)
    }, [setCollapsed])


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

    const claudeSection = (
        <div className={`bg-panel rounded overflow-hidden min-h-0 flex flex-col transition-all duration-200 ${localFocus === 'claude' ? 'border-2 border-blue-500/60 shadow-lg shadow-blue-500/20' : 'border border-slate-800'}`}>
            <div 
                className={`h-8 px-3 text-xs border-b cursor-pointer flex-shrink-0 flex items-center justify-between transition-colors duration-200 ${
                    localFocus === 'claude' 
                        ? 'bg-blue-900/30 text-blue-200 border-blue-800/50 hover:bg-blue-900/40' 
                        : 'text-slate-400 border-slate-800 hover:bg-slate-800'
                }`}
                onClick={handleClaudeSessionClick}
            >
                <span className="flex-1 text-center font-medium">
                    {selection.kind === 'orchestrator' ? 'Orchestrator — main repo' : `Session — ${selection.payload ?? ''}`}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded mr-1 transition-colors duration-200 ${
                    localFocus === 'claude' 
                        ? 'bg-blue-600/40 text-blue-200' 
                        : 'bg-slate-700/50 text-slate-400'
                }`} title="Focus Claude (⌘T)">⌘T</span>
            </div>
            <div className={`h-[2px] flex-shrink-0 transition-opacity duration-200 ${
                localFocus === 'claude' 
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
    )


    if (isCollapsed) {
        return (
            <div className="h-full px-2 pb-2 pt-0 relative">
                {claudeSection}
            <div className="mt-2 flex justify-center">
                    <button
                        onClick={async () => { try { await setCollapsed(false) } catch {} }}
                        className="px-3 py-1 text-xs bg-slate-700/50 text-slate-400 hover:bg-slate-600/50 rounded border border-slate-600 transition-colors flex items-center gap-1"
                        title="Show Terminal (⌘/)"
                    >
                        <span>▼</span>
                        <span>Show Terminal</span>
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div ref={containerRef} className="h-full px-2 pb-2 pt-0 relative">
            <Split 
                className="h-full flex flex-col" 
                direction="vertical" 
                sizes={sizes || [65, 35]} 
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
                    <div className="flex-1 min-h-0" onClick={handleTerminalClick}>
                        <TerminalTabs
                            key={`terminal-tabs-${terminalKey}`}
                            ref={terminalTabsRef}
                            baseTerminalId={terminals.bottomBase}
                            workingDirectory={terminals.workingDirectory}
                            className="h-full"
                            sessionName={selection.kind === 'session' ? selection.payload : undefined}
                            isOrchestrator={selection.kind === 'orchestrator'}
                        />
                    </div>
                </div>
            </Split>

            {/* Prompt dock moved to right diff panel */}
        </div>
    )
}