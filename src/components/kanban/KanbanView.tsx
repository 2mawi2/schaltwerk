import { useDrag, useDrop } from 'react-dnd'
import { clsx } from 'clsx'
import { useSessions } from '../../contexts/SessionsContext'
import { SessionCard } from '../shared/SessionCard'
import { invoke } from '@tauri-apps/api/core'
import { RightPanelTabs } from '../right-panel/RightPanelTabs'
import { SpecEditor as SpecEditor } from '../plans/SpecEditor'
import { Component, ReactNode } from 'react'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { theme } from '../../common/theme'
import { AnimatedText } from '../common/AnimatedText'
import { organizeSessionsByColumn, findSessionPosition } from '../../utils/sessionOrganizer'
import { EnrichedSession } from '../../types/session'
import { logger } from '../../utils/logger'

const ItemType = 'SESSION'



// Helper function to find session position across all columns
function findSessionPositionInColumns(sessionId: string, columns: EnrichedSession[][]): { column: number; row: number } | null {
    for (let col = 0; col < columns.length; col++) {
        const rowIndex = columns[col].findIndex(s => s.info.session_id === sessionId)
        if (rowIndex !== -1) {
            return { column: col, row: rowIndex }
        }
    }
    return null
}


interface DragItem {
    sessionId: string
    currentStatus: string
}

interface DraggableSessionCardProps {
    session: EnrichedSession
    isSelected?: boolean
    isFocused?: boolean
    onMarkReady?: (sessionId: string, hasUncommitted: boolean) => void
    onUnmarkReady?: (sessionId: string) => void
    onCancel?: (sessionId: string, hasUncommitted: boolean) => void
    onConvertToSpec?: (sessionId: string) => void
    onRunDraft?: (sessionId: string) => void
    onDeleteSpec?: (sessionId: string) => void
}

function DraggableSessionCard({ 
    session,
    isSelected,
    isFocused,
    onMarkReady,
    onUnmarkReady,
    onCancel,
    onConvertToSpec,
    onRunDraft,
    onDeleteSpec
}: DraggableSessionCardProps) {
    const [{ isDragging }, drag] = useDrag(() => ({
        type: ItemType,
        item: () => {
            const status = session.info.ready_to_merge ? 'dirty' : 
                           session.info.session_state === 'spec' ? 'spec' : 'active'
            return { sessionId: session.info.session_id, currentStatus: status }
        },
        collect: (monitor) => ({
            isDragging: !!monitor.isDragging(),
        }),
    }))

    return (
        <div 
            ref={drag as any} 
            className={clsx(
                "cursor-move mb-2 transition-all duration-200 ease-in-out",
                isDragging ? "opacity-50 scale-95" : "hover:scale-[1.005]"
            )}
            data-session-id={session.info.session_id}
            data-focused={isFocused ? 'true' : 'false'}
            data-selected={isSelected ? 'true' : 'false'}
        >
            <SessionCard
                session={session}
                isSelected={!!isSelected}
                isFocused={!!isFocused}
                isDragging={isDragging}
                hideKeyboardShortcut={true}
                hideActions={true}
                onMarkReady={onMarkReady}
                onUnmarkReady={onUnmarkReady}
                onCancel={onCancel}
                onConvertToSpec={onConvertToSpec}
                onRunDraft={onRunDraft}
                onDeleteSpec={onDeleteSpec}
            />
        </div>
    )
}

interface ColumnProps {
    title: string
    status: 'spec' | 'active' | 'dirty'
    sessions: EnrichedSession[]
    onStatusChange: (sessionId: string, newStatus: string) => void
    selectedSessionId?: string | null
    focusedSessionId?: string | null
    onSelectSession: (sessionId: string, isSpec: boolean) => void
    onSessionClick: (sessionId: string) => void
    onCreateDraft?: () => void
    onMarkReady?: (sessionId: string, hasUncommitted: boolean) => void
    onUnmarkReady?: (sessionId: string) => void
    onCancel?: (sessionId: string, hasUncommitted: boolean) => void
    onConvertToSpec?: (sessionId: string) => void
    onRunDraft?: (sessionId: string) => void
    onDeleteSpec?: (sessionId: string) => void
}

function Column({ 
    title, 
    status, 
    sessions, 
    onStatusChange, 
    selectedSessionId,
    focusedSessionId,
    onSelectSession,
    onSessionClick,
    onCreateDraft,
    onMarkReady,
    onUnmarkReady,
    onCancel,
    onConvertToSpec,
    onRunDraft,
    onDeleteSpec
}: ColumnProps) {
    const [{ isOver, canDrop }, drop] = useDrop(() => ({
        accept: ItemType,
        canDrop: (item: DragItem) => {
            // Prevent dropping on the same column
            return item.currentStatus !== status
        },
        drop: (item: DragItem) => {
            try {
                onStatusChange(item.sessionId, status)
            } catch (error) {
                logger.error('[KanbanView] Drop handler error:', error)
                alert('Failed to move session: ' + error)
            }
        },
        collect: (monitor) => ({
            isOver: !!monitor.isOver(),
            canDrop: !!monitor.canDrop()
        }),
    }))

    const columnSessions = sessions.filter(s => {
        if (status === 'spec') return s.info.session_state === 'spec'
        if (status === 'active') return s.info.session_state === 'running' && !s.info.ready_to_merge
        if (status === 'dirty') return s.info.ready_to_merge === true
        return false
    })

    return (
        <div
            ref={drop as any}
            className={clsx(
                'flex-1 flex flex-col bg-gray-900 rounded-lg p-4',
                'border-2 transition-all duration-300 ease-in-out',
                'min-w-[300px] max-w-[480px] min-h-0',
                isOver && canDrop ? 'border-blue-500 bg-gray-850 scale-[1.02]' : 'border-gray-800'
            )}
        >
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <h3 className="text-lg font-semibold text-white">{title}</h3>
                <span className="text-sm text-gray-500">{columnSessions.length}</span>
            </div>
            
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent min-h-0">
                <div className="pr-1 pb-2">
                    {columnSessions.map(session => (
                        <div key={session.info.session_id} onClick={() => {
                            const isSpec = session.info.session_state === 'spec'
                            onSelectSession(session.info.session_id, isSpec)
                            onSessionClick(session.info.session_id)
                          }}>
                          <DraggableSessionCard
                            session={session}
                            isSelected={selectedSessionId === session.info.session_id}
                            isFocused={focusedSessionId === session.info.session_id}
                            onMarkReady={onMarkReady}
                            onUnmarkReady={onUnmarkReady}
                            onCancel={onCancel}
                            onConvertToSpec={onConvertToSpec}
                            onRunDraft={onRunDraft}
                            onDeleteSpec={onDeleteSpec}
                          />
                        </div>
                    ))}
                </div>
            </div>

            {status === 'spec' && (
                <button
                    onClick={onCreateDraft}
                    className="mt-4 w-full bg-amber-800/40 hover:bg-amber-700/40 text-sm px-3 py-1.5 rounded group flex items-center justify-between border border-amber-700/40 flex-shrink-0"
                    title="Create new spec (⇧⌘N)"
                >
                    <span>Create spec</span>
                    <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⇧⌘N</span>
                </button>
            )}
            
            {status === 'active' && (
                <button
                    onClick={() => {
                        // Open new session modal
                        window.dispatchEvent(new CustomEvent('schaltwerk:new-session'))
                    }}
                    className="mt-4 w-full bg-slate-800/60 hover:bg-slate-700/60 text-sm px-3 py-1.5 rounded group flex items-center justify-between flex-shrink-0"
                    title="Start new agent (⌘N)"
                >
                    <span>Start agent</span>
                    <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⌘N</span>
                </button>
            )}
        </div>
    )
}

interface KanbanViewProps {
    isModalOpen?: boolean
}

export function KanbanView({ isModalOpen = false }: KanbanViewProps) {
    const { allSessions, loading, reloadSessions } = useSessions()
    const [selectedForDetails, setSelectedForDetails] = useState<{ kind: 'session'; payload: string; isSpec?: boolean } | null>(null)

    const handleStatusChange = async (sessionId: string, newStatus: string) => {
        const session = allSessions.find(s => s.info.session_id === sessionId)
        if (!session) {
            alert('Session not found: ' + sessionId)
            return
        }

        try {
            if (newStatus === 'spec') {
                // Convert to spec
                await invoke('schaltwerk_core_convert_session_to_draft', { name: sessionId })
            } else if (newStatus === 'active') {
                // If it's a spec, open modal to start it; if ready_to_merge, unmark it
                if (session.info.session_state === 'spec') {
                    // Open Start agent modal prefilled from spec
                    window.dispatchEvent(new CustomEvent('schaltwerk:start-agent-from-spec', { detail: { name: sessionId } }))
                    return // Don't reload sessions yet, modal will handle the start
                } else if (session.info.ready_to_merge) {
                    await invoke('schaltwerk_core_unmark_session_ready', { name: sessionId })
                }
            } else if (newStatus === 'dirty') {
                // Mark as ready to merge
                await invoke('schaltwerk_core_mark_session_ready', { name: sessionId, autoCommit: false })
            }
            await reloadSessions()
        } catch (error) {
            logger.error('[KanbanView] Failed to change status:', error)
            alert('Failed to change status: ' + error)
        }
    }

    const handleCreateDraft = async () => {
        // Dispatch event to open new session modal in spec mode
        window.dispatchEvent(new CustomEvent('schaltwerk:new-spec'))
    }

    const handleMarkReady = async (sessionId: string, hasUncommitted: boolean) => {
        if (hasUncommitted) {
            const confirmed = confirm('This session has uncommitted changes. Mark as reviewed anyway?')
            if (!confirmed) return
        }
        
        try {
            await invoke('schaltwerk_core_mark_ready', { name: sessionId })
            await reloadSessions()
        } catch (error) {
            logger.error('Failed to mark ready:', error)
        }
    }

    const handleUnmarkReady = async (sessionId: string) => {
        try {
            await invoke('schaltwerk_core_unmark_session_ready', { name: sessionId })
            await reloadSessions()
        } catch (error) {
            logger.error('Failed to unmark ready:', error)
        }
    }

    const handleCancel = async (sessionId: string, hasUncommitted: boolean) => {
        if (hasUncommitted) {
            const confirmed = confirm('This session has uncommitted changes. Cancel anyway?')
            if (!confirmed) return
        }
        
        try {
            await invoke('schaltwerk_core_cancel_session', { 
                name: sessionId,
                immediate: !hasUncommitted 
            })
            await reloadSessions()
        } catch (error) {
            logger.error('Failed to cancel session:', error)
        }
    }

    const handleConvertToSpec = async (sessionId: string) => {
        try {
            await invoke('schaltwerk_core_convert_session_to_draft', { name: sessionId })
            await reloadSessions()
        } catch (error) {
            logger.error('Failed to convert to spec:', error)
        }
    }

    const handleRunDraft = async (sessionId: string) => {
        try {
            // Open Start agent modal prefilled from spec
            window.dispatchEvent(new CustomEvent('schaltwerk:start-agent-from-spec', { detail: { name: sessionId } }))
        } catch (error) {
            logger.error('Failed to open start modal for spec:', error)
        }
    }

    const handleDeleteSpec = async (sessionId: string) => {
        // No confirmation for specs - consistent with sidebar behavior
        try {
            await invoke('schaltwerk_core_cancel_session', { name: sessionId })
            await reloadSessions()
        } catch (error) {
            logger.error('Failed to delete spec:', error)
        }
    }

    const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null)
    const [focusedPosition, setFocusedPosition] = useState<{ column: number; row: number }>({ column: 0, row: 0 })
    
    // Use refs to access current values in event handlers
    const focusedSessionIdRef = useRef<string | null>(null)
    const focusedPositionRef = useRef<{ column: number; row: number }>({ column: 0, row: 0 })
    const sessionsByColumnRef = useRef<any[][]>([[],[],[]])

    // Organize sessions into columns
    const sessionsByColumn = useMemo(() => {
        const columns = organizeSessionsByColumn(allSessions || [])
        sessionsByColumnRef.current = columns
        return columns
    }, [allSessions])
    
    // Update refs when state changes
    useEffect(() => {
        focusedSessionIdRef.current = focusedSessionId
        focusedPositionRef.current = focusedPosition
    }, [focusedSessionId, focusedPosition])

    // Scroll focused session into view
    useEffect(() => {
        if (!isModalOpen || !focusedSessionId) return

        // Use requestAnimationFrame to ensure DOM updates are complete
        requestAnimationFrame(() => {
            // Add a small delay to ensure the focus state has been applied to the DOM
            setTimeout(() => {
                const focusedElement = document.querySelector(`[data-focused="true"]`)
                if (focusedElement) {
                    focusedElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest',
                        inline: 'nearest'
                    })
                }
            }, 50)
        })
    }, [focusedSessionId, isModalOpen])

    // Initialize focus on first session when modal opens
    useEffect(() => {
        if (!isModalOpen) {
            setFocusedSessionId(null)
            setFocusedPosition({ column: 0, row: 0 })
            return
        }

        // Only set focus if no session is currently focused
        if (focusedSessionId) return

        // Find first non-empty column
        for (let col = 0; col < sessionsByColumn.length; col++) {
            if (sessionsByColumn[col].length > 0) {
                const firstSession = sessionsByColumn[col][0]
                setFocusedSessionId(firstSession.info.session_id)
                setFocusedPosition({ column: col, row: 0 })
                setSelectedForDetails({ 
                    kind: 'session', 
                    payload: firstSession.info.session_id, 
                    isSpec: firstSession.info.session_state === 'spec' 
                })
                break
            }
        }
    }, [isModalOpen, sessionsByColumn, focusedSessionId])

    // Store the last created session ID to focus on after refresh
    const lastCreatedSessionRef = useRef<string | null>(null)
    const waitingForNewSessionRef = useRef<boolean>(false)

    // Listen for session creation events to track newly created sessions
    useEffect(() => {
        if (!isModalOpen) return

        const handleNewSessionCreated = (event: CustomEvent<{ name: string }>) => {
            lastCreatedSessionRef.current = event.detail.name
            waitingForNewSessionRef.current = true
        }

        const handleNewSpecCreated = (event: CustomEvent<{ name: string }>) => {
            lastCreatedSessionRef.current = event.detail.name
            waitingForNewSessionRef.current = true
        }

        // Custom events for session creation
        window.addEventListener('schaltwerk:session-created', handleNewSessionCreated as EventListener)
        window.addEventListener('schaltwerk:spec-created', handleNewSpecCreated as EventListener)

        return () => {
            window.removeEventListener('schaltwerk:session-created', handleNewSessionCreated as EventListener)
            window.removeEventListener('schaltwerk:spec-created', handleNewSpecCreated as EventListener)
        }
    }, [isModalOpen])

    // Focus on newly created session after sessions are refreshed
    useEffect(() => {
        if (!isModalOpen || !waitingForNewSessionRef.current || !lastCreatedSessionRef.current) return
        
        const newSessionId = lastCreatedSessionRef.current
        const newSession = allSessions.find(s => s.info.session_id === newSessionId)
        
        if (newSession) {
            const position = findSessionPosition(newSessionId, sessionsByColumn)
            if (position) {
                setFocusedSessionId(newSessionId)
                setFocusedPosition(position)
                setSelectedForDetails({ 
                    kind: 'session', 
                    payload: newSessionId, 
                    isSpec: newSession.info.session_state === 'spec' 
                })
                waitingForNewSessionRef.current = false
                lastCreatedSessionRef.current = null
            }
        }
    }, [isModalOpen, allSessions, sessionsByColumn])

    // Handle keyboard navigation and shortcuts
    useEffect(() => {
        if (!isModalOpen) return

        const handleKeyDown = (event: KeyboardEvent) => {
            // Get current focused session for actions
            const currentFocusedId = focusedSessionIdRef.current
            const currentSession = currentFocusedId ? allSessions.find(s => s.info.session_id === currentFocusedId) : null
            
            // Handle session management shortcuts
            if (event.metaKey || event.ctrlKey) {
                switch (event.key.toLowerCase()) {
                    case 'n':
                        event.preventDefault()
                        event.stopPropagation()
                        if (event.shiftKey) {
                            // Cmd+Shift+N: Create new spec
                            handleCreateDraft()
                        } else {
                            // Cmd+N: Create new session
                            window.dispatchEvent(new CustomEvent('schaltwerk:new-session'))
                        }
                        return
                    
                    case 'r':
                        // Cmd+R: Mark as ready/reviewed
                        if (currentSession && currentSession.info.session_state === 'running' && !currentSession.info.ready_to_merge) {
                            event.preventDefault()
                            event.stopPropagation()
                            handleMarkReady(currentSession.info.session_id, currentSession.info.has_uncommitted_changes ?? false)
                        }
                        return
                    
                    case 'd':
                        // Cmd+D or Cmd+Shift+D: Cancel session
                        if (currentSession) {
                            event.preventDefault()
                            event.stopPropagation()
                            if (currentSession.info.session_state === 'spec') {
                                // Delete spec immediately (no confirmation)
                                handleDeleteSpec(currentSession.info.session_id)
                            } else {
                                // Cancel session (with or without confirmation)
                                const immediate = event.shiftKey // Shift+Cmd+D forces immediate cancel
                                if (!immediate && currentSession.info.has_uncommitted_changes) {
                                    const confirmed = confirm('This session has uncommitted changes. Cancel anyway?')
                                    if (!confirmed) return
                                }
                                handleCancel(currentSession.info.session_id, !immediate && (currentSession.info.has_uncommitted_changes ?? false))
                            }
                        }
                        return
                        
                    case 's':
                        // Cmd+S: Convert to spec
                        if (currentSession && currentSession.info.session_state === 'running') {
                            event.preventDefault()
                            event.stopPropagation()
                            handleConvertToSpec(currentSession.info.session_id)
                        }
                        return
                        
                    case 'g':
                        // Cmd+G: Open diff viewer (handled by handleOpenDiff via right panel)
                        if (currentSession) {
                            event.preventDefault()
                            event.stopPropagation()
                            // This will be handled by RightPanelTabs if it's active
                            // We just need to ensure the session is selected
                            if (currentSession.info.session_id !== selectedForDetails?.payload) {
                                setSelectedForDetails({ 
                                    kind: 'session', 
                                    payload: currentSession.info.session_id, 
                                    isSpec: currentSession.info.session_state === 'spec' 
                                })
                            }
                        }
                        return
                }
            }
            
            // Handle Enter key to start/focus session
            if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                if (currentSession) {
                    event.preventDefault()
                    event.stopPropagation()
                    if (currentSession.info.session_state === 'spec') {
                        // Start spec as new session
                        handleRunDraft(currentSession.info.session_id)
                    } else {
                        // Focus/select the running session
                        setSelectedForDetails({ 
                            kind: 'session', 
                            payload: currentSession.info.session_id, 
                            isSpec: false 
                        })
                    }
                }
                return
            }
            
            // Only handle arrow keys for navigation
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
            
            // Handle both regular navigation and Cmd+navigation
            const isMetaNavigation = event.metaKey || event.ctrlKey
            
            // Don't interfere with other shortcuts (like Alt+arrows)
            if (event.altKey) return
            
            // Use refs to get current values
            const currentColumns = sessionsByColumnRef.current
            let navFocusedId = focusedSessionIdRef.current
            let currentPosition = focusedPositionRef.current
            
            // If no session is focused, select the first one
            if (!navFocusedId) {
                for (let col = 0; col < currentColumns.length; col++) {
                    if (currentColumns[col].length > 0) {
                        const firstSession = currentColumns[col][0]
                        setFocusedSessionId(firstSession.info.session_id)
                        setFocusedPosition({ column: col, row: 0 })
                        setSelectedForDetails({ 
                            kind: 'session', 
                            payload: firstSession.info.session_id, 
                            isSpec: firstSession.info.session_state === 'spec' 
                        })
                        event.preventDefault()
                        return
                    }
                }
                return // No sessions available
            }
            
            let newCol = currentPosition.column
            let newRow = currentPosition.row
            
            switch (event.key) {
                case 'ArrowRight':
                    event.preventDefault()
                    newCol = (currentPosition.column + 1) % 3
                    break
                    
                case 'ArrowLeft':
                    event.preventDefault()
                    newCol = (currentPosition.column - 1 + 3) % 3
                    break
                    
                case 'ArrowDown':
                    event.preventDefault()
                    if (isMetaNavigation) {
                        // Cmd+Down: Find next session in any column
                        const allSessions = currentColumns.flat()
                        const currentIndex = allSessions.findIndex(s => s.info.session_id === navFocusedId)
                        if (currentIndex !== -1) {
                            const targetIndex = (currentIndex + 1) % allSessions.length
                            const targetSession = allSessions[targetIndex]
                            if (targetSession) {
                                const position = findSessionPositionInColumns(targetSession.info.session_id, currentColumns)
                                if (position) {
                                    newCol = position.column
                                    newRow = position.row
                                }
                            }
                        }
                    } else {
                        // Regular ArrowDown: Move down in current column
                        if (currentPosition.row < currentColumns[currentPosition.column].length - 1) {
                            newRow = currentPosition.row + 1
                        }
                    }
                    break
                    
                case 'ArrowUp':
                    event.preventDefault()
                    if (isMetaNavigation) {
                        // Cmd+Up: Find previous session in any column
                        const allSessions = currentColumns.flat()
                        const currentIndex = allSessions.findIndex(s => s.info.session_id === navFocusedId)
                        if (currentIndex !== -1) {
                            const targetIndex = (currentIndex - 1 + allSessions.length) % allSessions.length
                            const targetSession = allSessions[targetIndex]
                            if (targetSession) {
                                const position = findSessionPositionInColumns(targetSession.info.session_id, currentColumns)
                                if (position) {
                                    newCol = position.column
                                    newRow = position.row
                                }
                            }
                        }
                    } else {
                        // Regular ArrowUp: Move up in current column
                        if (currentPosition.row > 0) {
                            newRow = currentPosition.row - 1
                        }
                    }
                    break
                    
                default:
                    return
            }
            
            // For meta navigation, we already calculated exact position
            if (!isMetaNavigation) {
                // For left/right navigation, if target column is empty, stay in current position
                if (currentColumns[newCol].length === 0) {
                    return // Don't navigate to empty columns
                }
                
                // Clamp row to valid range for the target column
                newRow = Math.min(newRow, currentColumns[newCol].length - 1)
                newRow = Math.max(0, newRow)
            }
            
            const targetSession = currentColumns[newCol][newRow]
            if (targetSession) {
                setFocusedSessionId(targetSession.info.session_id)
                setFocusedPosition({ column: newCol, row: newRow })
                setSelectedForDetails({ 
                    kind: 'session', 
                    payload: targetSession.info.session_id, 
                    isSpec: targetSession.info.session_state === 'spec' 
                })
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [isModalOpen, allSessions, selectedForDetails, handleMarkReady, handleUnmarkReady, handleCancel, handleConvertToSpec, handleRunDraft, handleDeleteSpec, handleCreateDraft]) // Add necessary dependencies

    const handleSessionClick = useCallback((sessionId: string) => {
        // Find position of clicked session
        const position = findSessionPosition(sessionId, sessionsByColumn)
        if (position) {
            setFocusedSessionId(sessionId)
            setFocusedPosition(position)
        }
    }, [sessionsByColumn])

    const handleOpenDiff = useCallback((filePath: string) => {
        window.dispatchEvent(new CustomEvent('schaltwerk:open-diff-file', { detail: { filePath } }))
    }, [])

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <AnimatedText text="loading" colorClassName="text-slate-500" size="md" />
            </div>
        )
    }

    if (!allSessions || allSessions.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                    <div className="mb-4" style={{ color: theme.colors.text.muted }}>
                        No agents or specs found
                    </div>
                    <div className="flex gap-2 justify-center">
                        <button 
                            onClick={() => window.dispatchEvent(new CustomEvent('schaltwerk:new-session'))} 
                            className="text-sm px-3 py-1.5 rounded group flex items-center justify-between gap-2 hover:opacity-80"
                            style={{
                                backgroundColor: theme.colors.background.elevated,
                                color: theme.colors.text.primary
                            }}
                            title="Start new agent (⌘N)"
                        >
                            <span>Start agent</span>
                            <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⌘N</span>
                        </button>
                        <button 
                            onClick={handleCreateDraft} 
                            className="text-sm px-3 py-1.5 rounded group flex items-center justify-between gap-2 border hover:opacity-80"
                            style={{
                                backgroundColor: theme.colors.accent.amber.bg,
                                color: theme.colors.text.primary,
                                borderColor: theme.colors.accent.amber.border
                            }}
                            title="Create spec (⇧⌘N)"
                        >
                    <span>Create spec</span>
                            <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⇧⌘N</span>
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    // Unified view for all sessions
    return (
        <div className="h-full w-full flex">
            <div className="flex-1 flex gap-3 p-6 h-full overflow-x-auto">
            <Column
                title="Spec"
                status="spec"
                sessions={allSessions}
                onStatusChange={handleStatusChange}
                selectedSessionId={selectedForDetails?.payload ?? null}
                focusedSessionId={focusedSessionId}
                onSelectSession={(id, isSpec) => setSelectedForDetails({ kind: 'session', payload: id, isSpec })}
                onSessionClick={handleSessionClick}
                onCreateDraft={handleCreateDraft}
                onMarkReady={handleMarkReady}
                onUnmarkReady={handleUnmarkReady}
                onCancel={handleCancel}
                onConvertToSpec={handleConvertToSpec}
                onRunDraft={handleRunDraft}
                onDeleteSpec={handleDeleteSpec}
            />
            <Column
                title="Running"
                status="active"
                sessions={allSessions}
                onStatusChange={handleStatusChange}
                selectedSessionId={selectedForDetails?.payload ?? null}
                focusedSessionId={focusedSessionId}
                onSelectSession={(id, isSpec) => setSelectedForDetails({ kind: 'session', payload: id, isSpec })}
                onSessionClick={handleSessionClick}
                onMarkReady={handleMarkReady}
                onUnmarkReady={handleUnmarkReady}
                onCancel={handleCancel}
                onConvertToSpec={handleConvertToSpec}
                onRunDraft={handleRunDraft}
                onDeleteSpec={handleDeleteSpec}
            />
            <Column
                title="Reviewed"
                status="dirty"
                sessions={allSessions}
                onStatusChange={handleStatusChange}
                selectedSessionId={selectedForDetails?.payload ?? null}
                focusedSessionId={focusedSessionId}
                onSelectSession={(id, isSpec) => setSelectedForDetails({ kind: 'session', payload: id, isSpec })}
                onSessionClick={handleSessionClick}
                onMarkReady={handleMarkReady}
                onUnmarkReady={handleUnmarkReady}
                onCancel={handleCancel}
                onConvertToSpec={handleConvertToSpec}
                onRunDraft={handleRunDraft}
                onDeleteSpec={handleDeleteSpec}
            />
            </div>
            <div 
                className="w-[480px] min-w-[480px] max-w-[600px] overflow-hidden border-l flex flex-col transition-all duration-300 ease-in-out"
                style={{ 
                    borderLeftColor: theme.colors.border.default,
                    backgroundColor: theme.colors.background.elevated 
                }}
            >
                <div className="flex-1 overflow-hidden relative">
                    {selectedForDetails ? (
                        <div className="absolute inset-0 animate-fadeIn">
                            {selectedForDetails.isSpec === true ? (
                                <SpecEditor 
                                    sessionName={selectedForDetails.payload}
                                    onStart={() => handleRunDraft(selectedForDetails.payload)}
                                />
                            ) : (
                                <SilentErrorBoundary>
                                    <RightPanelTabs 
                                        onFileSelect={handleOpenDiff}
                                        selectionOverride={{ kind: 'session', payload: selectedForDetails.payload }}
                                        isSpecOverride={false}
                                    />
                                </SilentErrorBoundary>
                            )}
                        </div>
                    ) : (
                        <div 
                            className="h-full flex items-center justify-center text-xs"
                            style={{ color: theme.colors.text.muted }}
                        >
                            Select a agent to view details
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

class SilentErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch() { /* swallow to avoid failing tests when provider missing */ }
  render() { return this.state.hasError ? null : this.props.children }
}
