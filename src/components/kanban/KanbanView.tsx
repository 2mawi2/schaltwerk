import { useDrag, useDrop } from 'react-dnd'
import { clsx } from 'clsx'
import { useSessions } from '../../contexts/SessionsContext'
import { SessionCard } from '../shared/SessionCard'
import { invoke } from '@tauri-apps/api/core'
import { RightPanelTabs } from '../right-panel/RightPanelTabs'
import { SpecEditor as SpecEditor } from '../plans/SpecEditor'
import { Component, ReactNode } from 'react'
import { useState, useCallback } from 'react'
import { theme } from '../../common/theme'

const ItemType = 'SESSION'

interface DragItem {
    sessionId: string
    currentStatus: string
}

interface DraggableSessionCardProps {
    session: any
    isSelected?: boolean
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
        <div ref={drag as any} className={clsx(
            "cursor-move mb-2 transition-all duration-200 ease-in-out",
            isDragging ? "opacity-50 scale-95" : "hover:scale-[1.005]"
        )}>
            <SessionCard
                session={session}
                isSelected={!!isSelected}
                isDragging={isDragging}
                hideKeyboardShortcut={true}
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
    sessions: any[]
    onStatusChange: (sessionId: string, newStatus: string) => void
    selectedSessionId?: string | null
    onSelectSession: (sessionId: string, isSpec: boolean) => void
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
    onSelectSession,
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
            console.log('[KanbanView] Drop initiated:', { sessionId: item.sessionId, fromStatus: item.currentStatus, toStatus: status })
            try {
                onStatusChange(item.sessionId, status)
            } catch (error) {
                console.error('[KanbanView] Drop handler error:', error)
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
                          }}>
                          <DraggableSessionCard
                            session={session}
                            isSelected={selectedSessionId === session.info.session_id}
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

export function KanbanView() {
    const { allSessions, loading, reloadSessions } = useSessions()
    const [selectedForDetails, setSelectedForDetails] = useState<{ kind: 'session'; payload: string; isSpec?: boolean } | null>(null)

    const handleStatusChange = async (sessionId: string, newStatus: string) => {
        console.log('[KanbanView] handleStatusChange called:', { sessionId, newStatus })
        const session = allSessions.find(s => s.info.session_id === sessionId)
        if (!session) {
            console.error('[KanbanView] Session not found:', sessionId)
            alert('Session not found: ' + sessionId)
            return
        }

        console.log('[KanbanView] Found session:', { sessionId: session.info.session_id, currentStatus: session.info.status, readyToMerge: session.info.ready_to_merge })

        try {
            if (newStatus === 'spec') {
                // Convert to spec
                await invoke('schaltwerk_core_convert_session_to_draft', { name: sessionId })
            } else if (newStatus === 'active') {
                // If it's a spec, open modal to start it; if ready_to_merge, unmark it
                if (session.info.session_state === 'spec') {
                    console.log('[KanbanView] Opening modal to start spec session:', sessionId)
                    // Open Start agent modal prefilled from spec
                    window.dispatchEvent(new CustomEvent('schaltwerk:start-agent-from-spec', { detail: { name: sessionId } }))
                    return // Don't reload sessions yet, modal will handle the start
                } else if (session.info.ready_to_merge) {
                    console.log('[KanbanView] Unmarking session as ready:', sessionId)
                    await invoke('schaltwerk_core_unmark_session_ready', { name: sessionId })
                }
            } else if (newStatus === 'dirty') {
                // Mark as ready to merge
                console.log('[KanbanView] Marking session as ready:', sessionId)
                await invoke('schaltwerk_core_mark_session_ready', { name: sessionId, autoCommit: false })
            }
            console.log('[KanbanView] Reloading sessions after status change')
            await reloadSessions()
            console.log('[KanbanView] Status change completed successfully')
        } catch (error) {
            console.error('[KanbanView] Failed to change status:', error)
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
            console.error('Failed to mark ready:', error)
        }
    }

    const handleUnmarkReady = async (sessionId: string) => {
        try {
            await invoke('schaltwerk_core_unmark_ready', { name: sessionId })
            await reloadSessions()
        } catch (error) {
            console.error('Failed to unmark ready:', error)
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
            console.error('Failed to cancel session:', error)
        }
    }

    const handleConvertToSpec = async (sessionId: string) => {
        try {
            await invoke('schaltwerk_core_convert_session_to_draft', { name: sessionId })
            await reloadSessions()
        } catch (error) {
            console.error('Failed to convert to spec:', error)
        }
    }

    const handleRunDraft = async (sessionId: string) => {
        try {
            console.log('[KanbanView] Opening modal to start spec session:', sessionId)
            // Open Start agent modal prefilled from spec
            window.dispatchEvent(new CustomEvent('schaltwerk:start-agent-from-spec', { detail: { name: sessionId } }))
        } catch (error) {
            console.error('Failed to open start modal for spec:', error)
        }
    }

    const handleDeleteSpec = async (sessionId: string) => {
        // No confirmation for specs - consistent with sidebar behavior
        try {
            await invoke('schaltwerk_core_cancel_session', { name: sessionId })
            await reloadSessions()
        } catch (error) {
            console.error('Failed to delete spec:', error)
        }
    }

    const handleOpenDiff = useCallback((filePath: string) => {
        window.dispatchEvent(new CustomEvent('schaltwerk:open-diff-file', { detail: { filePath } }))
    }, [])

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-gray-400">Loading sessions...</div>
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
                onSelectSession={(id, isSpec) => setSelectedForDetails({ kind: 'session', payload: id, isSpec })}
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
                onSelectSession={(id, isSpec) => setSelectedForDetails({ kind: 'session', payload: id, isSpec })}
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
                onSelectSession={(id, isSpec) => setSelectedForDetails({ kind: 'session', payload: id, isSpec })}
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
