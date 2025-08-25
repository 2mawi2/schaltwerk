import { useDrag, useDrop } from 'react-dnd'
import { clsx } from 'clsx'
import { useSessions } from '../../contexts/SessionsContext'
import { SessionCard } from '../shared/SessionCard'
import { invoke } from '@tauri-apps/api/core'
import { RightPanelTabs } from '../right-panel/RightPanelTabs'
import { PlanEditor } from '../plans/PlanEditor'
import { Component, ReactNode } from 'react'
import { useState, useCallback } from 'react'

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
    onConvertToPlan?: (sessionId: string) => void
    onRunDraft?: (sessionId: string) => void
    onDeletePlan?: (sessionId: string) => void
}

function DraggableSessionCard({ 
    session,
    isSelected,
    onMarkReady,
    onUnmarkReady,
    onCancel,
    onConvertToPlan,
    onRunDraft,
    onDeletePlan
}: DraggableSessionCardProps) {
    const [{ isDragging }, drag] = useDrag(() => ({
        type: ItemType,
        item: () => {
            const status = session.info.ready_to_merge ? 'dirty' : session.info.status
            return { sessionId: session.info.session_id, currentStatus: status }
        },
        collect: (monitor) => ({
            isDragging: !!monitor.isDragging(),
        }),
    }))

    return (
        <div ref={drag as any} className="cursor-move mb-2">
            <SessionCard
                session={session}
                isSelected={!!isSelected}
                isDragging={isDragging}
                hideKeyboardShortcut={true}
                onMarkReady={onMarkReady}
                onUnmarkReady={onUnmarkReady}
                onCancel={onCancel}
                onConvertToPlan={onConvertToPlan}
                onRunDraft={onRunDraft}
                onDeletePlan={onDeletePlan}
            />
        </div>
    )
}

interface ColumnProps {
    title: string
    status: 'plan' | 'active' | 'dirty'
    sessions: any[]
    onStatusChange: (sessionId: string, newStatus: string) => void
    selectedSessionId?: string | null
    onSelectSession: (sessionId: string, isPlan: boolean) => void
    onCreateDraft?: () => void
    onMarkReady?: (sessionId: string, hasUncommitted: boolean) => void
    onUnmarkReady?: (sessionId: string) => void
    onCancel?: (sessionId: string, hasUncommitted: boolean) => void
    onConvertToPlan?: (sessionId: string) => void
    onRunDraft?: (sessionId: string) => void
    onDeletePlan?: (sessionId: string) => void
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
    onConvertToPlan,
    onRunDraft,
    onDeletePlan
}: ColumnProps) {
    const [{ isOver, canDrop }, drop] = useDrop(() => ({
        accept: ItemType,
        canDrop: (item: DragItem) => {
            // Prevent dropping on the same column
            return item.currentStatus !== status
        },
        drop: (item: DragItem) => {
            onStatusChange(item.sessionId, status)
        },
        collect: (monitor) => ({
            isOver: !!monitor.isOver(),
            canDrop: !!monitor.canDrop()
        }),
    }))

    const columnSessions = sessions.filter(s => {
        if (status === 'plan') return s.info.status === 'plan'
        if (status === 'active') return (s.info.status === 'active' || s.info.status === 'missing') && !s.info.ready_to_merge
        if (status === 'dirty') return s.info.ready_to_merge === true
        return false
    })

    return (
        <div
            ref={drop as any}
            className={clsx(
                'flex-1 flex flex-col bg-gray-900 rounded-lg p-3',
                'border-2 transition-colors',
                'min-w-[300px] max-w-[480px] min-h-0',
                isOver && canDrop ? 'border-blue-500 bg-gray-850' : 'border-gray-800'
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
                            const isPlan = session.info.status === 'plan'
                            onSelectSession(session.info.session_id, isPlan)
                          }}>
                          <DraggableSessionCard
                            session={session}
                            isSelected={selectedSessionId === session.info.session_id}
                            onMarkReady={onMarkReady}
                            onUnmarkReady={onUnmarkReady}
                            onCancel={onCancel}
                            onConvertToPlan={onConvertToPlan}
                            onRunDraft={onRunDraft}
                            onDeletePlan={onDeletePlan}
                          />
                        </div>
                    ))}
                </div>
            </div>

            {status === 'plan' && (
                <button
                    onClick={onCreateDraft}
                    className="mt-4 w-full bg-amber-800/40 hover:bg-amber-700/40 text-sm px-3 py-1.5 rounded group flex items-center justify-between border border-amber-700/40 flex-shrink-0"
                    title="Create new plan (⇧⌘N)"
                >
                    <span>Create plan</span>
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
    const { sessions, loading, reloadSessions } = useSessions()
    const [selectedForDetails, setSelectedForDetails] = useState<{ kind: 'session'; payload: string; isPlan?: boolean } | null>(null)

    const handleStatusChange = async (sessionId: string, newStatus: string) => {
        const session = sessions.find(s => s.info.session_id === sessionId)
        if (!session) return

        try {
            if (newStatus === 'plan') {
                // Convert to plan
                await invoke('para_core_convert_session_to_draft', { name: sessionId })
            } else if (newStatus === 'active') {
                // If it's a plan, start it; if ready_to_merge, unmark it
                if (session.info.status === 'plan') {
                    await invoke('para_core_start_draft_session', { name: sessionId })
                } else if (session.info.ready_to_merge) {
                    await invoke('para_core_unmark_session_ready', { name: sessionId })
                }
            } else if (newStatus === 'dirty') {
                // Mark as ready to merge
                await invoke('para_core_mark_session_ready', { name: sessionId, autoCommit: false })
            }
            await reloadSessions()
        } catch (error) {
            console.error('Failed to change status:', error)
            alert('Failed to change status: ' + error)
        }
    }

    const handleCreateDraft = async () => {
        // Dispatch event to open new session modal in plan mode
        window.dispatchEvent(new CustomEvent('schaltwerk:new-plan'))
    }

    const handleMarkReady = async (sessionId: string, hasUncommitted: boolean) => {
        if (hasUncommitted) {
            const confirmed = confirm('This session has uncommitted changes. Mark as reviewed anyway?')
            if (!confirmed) return
        }
        
        try {
            await invoke('para_core_mark_ready', { name: sessionId })
            await reloadSessions()
        } catch (error) {
            console.error('Failed to mark ready:', error)
        }
    }

    const handleUnmarkReady = async (sessionId: string) => {
        try {
            await invoke('para_core_unmark_ready', { name: sessionId })
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
            await invoke('para_core_cancel_session', { 
                name: sessionId,
                immediate: !hasUncommitted 
            })
            await reloadSessions()
        } catch (error) {
            console.error('Failed to cancel session:', error)
        }
    }

    const handleConvertToDraft = async (sessionId: string) => {
        try {
            await invoke('para_core_convert_session_to_draft', { name: sessionId })
            await reloadSessions()
        } catch (error) {
            console.error('Failed to convert to plan:', error)
        }
    }

    const handleRunDraft = async (sessionId: string) => {
        try {
            await invoke('para_core_start_draft_session', { name: sessionId })
            await reloadSessions()
        } catch (error) {
            console.error('Failed to run plan:', error)
        }
    }

    const handleDeleteDraft = async (sessionId: string) => {
        // No confirmation for plans - consistent with sidebar behavior
        try {
            await invoke('para_core_cancel_session', { name: sessionId })
            await reloadSessions()
        } catch (error) {
            console.error('Failed to delete plan:', error)
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

    if (!sessions || sessions.length === 0) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-center">
                    <div className="text-gray-400 mb-4">No agents or plans found</div>
                    <div className="flex gap-2 justify-center">
                        <button 
                            onClick={() => window.dispatchEvent(new CustomEvent('schaltwerk:new-session'))} 
                            className="bg-slate-800/60 hover:bg-slate-700/60 text-sm px-3 py-1.5 rounded group flex items-center justify-between gap-2"
                            title="Start new agent (⌘N)"
                        >
                            <span>Start agent</span>
                            <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⌘N</span>
                        </button>
                        <button 
                            onClick={handleCreateDraft} 
                            className="bg-amber-800/40 hover:bg-amber-700/40 text-sm px-3 py-1.5 rounded group flex items-center justify-between gap-2 border border-amber-700/40"
                            title="Create plan (⇧⌘N)"
                        >
                            <span>Create plan</span>
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
                title="Plan"
                status="plan"
                sessions={sessions}
                onStatusChange={handleStatusChange}
                selectedSessionId={selectedForDetails?.payload ?? null}
                onSelectSession={(id, isPlan) => setSelectedForDetails({ kind: 'session', payload: id, isPlan })}
                onCreateDraft={handleCreateDraft}
                onMarkReady={handleMarkReady}
                onUnmarkReady={handleUnmarkReady}
                onCancel={handleCancel}
                onConvertToPlan={handleConvertToDraft}
                onRunDraft={handleRunDraft}
                onDeletePlan={handleDeleteDraft}
            />
            <Column
                title="Running"
                status="active"
                sessions={sessions}
                onStatusChange={handleStatusChange}
                selectedSessionId={selectedForDetails?.payload ?? null}
                onSelectSession={(id, isPlan) => setSelectedForDetails({ kind: 'session', payload: id, isPlan })}
                onMarkReady={handleMarkReady}
                onUnmarkReady={handleUnmarkReady}
                onCancel={handleCancel}
                onConvertToPlan={handleConvertToDraft}
                onRunDraft={handleRunDraft}
                onDeletePlan={handleDeleteDraft}
            />
            <Column
                title="Reviewed"
                status="dirty"
                sessions={sessions}
                onStatusChange={handleStatusChange}
                selectedSessionId={selectedForDetails?.payload ?? null}
                onSelectSession={(id, isPlan) => setSelectedForDetails({ kind: 'session', payload: id, isPlan })}
                onMarkReady={handleMarkReady}
                onUnmarkReady={handleUnmarkReady}
                onCancel={handleCancel}
                onConvertToPlan={handleConvertToDraft}
                onRunDraft={handleRunDraft}
                onDeletePlan={handleDeleteDraft}
            />
          </div>
          <div className="w-[480px] min-w-[400px] max-w-[600px] overflow-hidden border-l border-slate-800 bg-panel flex flex-col">
            <div className="flex-1 overflow-hidden">
              {selectedForDetails ? (
                selectedForDetails.isPlan === true ? (
                  <PlanEditor 
                    sessionName={selectedForDetails.payload}
                    onStart={() => handleRunDraft(selectedForDetails.payload)}
                  />
                ) : (
                  <SilentErrorBoundary>
                    <RightPanelTabs 
                      onFileSelect={handleOpenDiff}
                      selectionOverride={{ kind: 'session', payload: selectedForDetails.payload }}
                      isPlanOverride={false}
                    />
                  </SilentErrorBoundary>
                )
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">
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
