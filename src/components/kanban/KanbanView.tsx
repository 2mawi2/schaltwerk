import { useDrag, useDrop } from 'react-dnd'
import { clsx } from 'clsx'
import { useSessions } from '../../contexts/SessionsContext'
import { SessionCard } from '../shared/SessionCard'
import { invoke } from '@tauri-apps/api/core'

const ItemType = 'SESSION'

interface DragItem {
    sessionId: string
    currentStatus: string
}

interface DraggableSessionCardProps {
    session: any
    onMarkReady?: (sessionId: string, hasUncommitted: boolean) => void
    onUnmarkReady?: (sessionId: string) => void
    onCancel?: (sessionId: string, hasUncommitted: boolean) => void
    onConvertToDraft?: (sessionId: string) => void
    onRunDraft?: (sessionId: string) => void
    onDeleteDraft?: (sessionId: string) => void
}

function DraggableSessionCard({ 
    session,
    onMarkReady,
    onUnmarkReady,
    onCancel,
    onConvertToDraft,
    onRunDraft,
    onDeleteDraft
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
                isDragging={isDragging}
                hideKeyboardShortcut={true}
                onMarkReady={onMarkReady}
                onUnmarkReady={onUnmarkReady}
                onCancel={onCancel}
                onConvertToDraft={onConvertToDraft}
                onRunDraft={onRunDraft}
                onDeleteDraft={onDeleteDraft}
            />
        </div>
    )
}

interface ColumnProps {
    title: string
    status: 'draft' | 'active' | 'dirty'
    sessions: any[]
    onStatusChange: (sessionId: string, newStatus: string) => void
    onCreateDraft?: () => void
    onMarkReady?: (sessionId: string, hasUncommitted: boolean) => void
    onUnmarkReady?: (sessionId: string) => void
    onCancel?: (sessionId: string, hasUncommitted: boolean) => void
    onConvertToDraft?: (sessionId: string) => void
    onRunDraft?: (sessionId: string) => void
    onDeleteDraft?: (sessionId: string) => void
}

function Column({ 
    title, 
    status, 
    sessions, 
    onStatusChange, 
    onCreateDraft,
    onMarkReady,
    onUnmarkReady,
    onCancel,
    onConvertToDraft,
    onRunDraft,
    onDeleteDraft
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
        if (status === 'draft') return s.info.status === 'draft'
        if (status === 'active') return (s.info.status === 'active' || s.info.status === 'missing') && !s.info.ready_to_merge
        if (status === 'dirty') return s.info.ready_to_merge === true
        return false
    })

    return (
        <div
            ref={drop as any}
            className={clsx(
                'flex-1 flex flex-col bg-gray-900 rounded-lg p-4',
                'border-2 transition-colors',
                'min-w-[380px] min-h-0',
                isOver && canDrop ? 'border-blue-500 bg-gray-850' : 'border-gray-800'
            )}
        >
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
                <h3 className="text-lg font-semibold text-white">{title}</h3>
                <span className="text-sm text-gray-500">{columnSessions.length}</span>
            </div>
            
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent min-h-0">
                <div className="pr-2 pb-2">
                    {columnSessions.map(session => (
                        <DraggableSessionCard
                            key={session.info.session_id}
                            session={session}
                            onMarkReady={onMarkReady}
                            onUnmarkReady={onUnmarkReady}
                            onCancel={onCancel}
                            onConvertToDraft={onConvertToDraft}
                            onRunDraft={onRunDraft}
                            onDeleteDraft={onDeleteDraft}
                        />
                    ))}
                </div>
            </div>

            {status === 'draft' && (
                <button
                    onClick={onCreateDraft}
                    className="mt-4 w-full bg-amber-800/40 hover:bg-amber-700/40 text-sm px-3 py-1.5 rounded group flex items-center justify-between border border-amber-700/40 flex-shrink-0"
                    title="Create new draft (⇧⌘N)"
                >
                    <span>New draft</span>
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
                    title="Start new task (⌘N)"
                >
                    <span>Start new task</span>
                    <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⌘N</span>
                </button>
            )}
        </div>
    )
}

export function KanbanView() {
    const { sessions, loading, reloadSessions } = useSessions()

    const handleStatusChange = async (sessionId: string, newStatus: string) => {
        const session = sessions.find(s => s.info.session_id === sessionId)
        if (!session) return

        try {
            if (newStatus === 'draft') {
                // Convert to draft
                await invoke('para_core_convert_session_to_draft', { name: sessionId })
            } else if (newStatus === 'active') {
                // If it's a draft, start it; if ready_to_merge, unmark it
                if (session.info.status === 'draft') {
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
        // Dispatch event to open new session modal in draft mode
        window.dispatchEvent(new CustomEvent('schaltwerk:new-draft'))
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
            console.error('Failed to convert to draft:', error)
        }
    }

    const handleRunDraft = async (sessionId: string) => {
        try {
            await invoke('para_core_start_draft_session', { name: sessionId })
            await reloadSessions()
        } catch (error) {
            console.error('Failed to run draft:', error)
        }
    }

    const handleDeleteDraft = async (sessionId: string) => {
        // No confirmation for drafts - consistent with sidebar behavior
        try {
            await invoke('para_core_cancel_session', { name: sessionId })
            await reloadSessions()
        } catch (error) {
            console.error('Failed to delete draft:', error)
        }
    }

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
                    <div className="text-gray-400 mb-4">No sessions found</div>
                    <div className="flex gap-2 justify-center">
                        <button 
                            onClick={() => window.dispatchEvent(new CustomEvent('schaltwerk:new-session'))} 
                            className="bg-slate-800/60 hover:bg-slate-700/60 text-sm px-3 py-1.5 rounded group flex items-center justify-between gap-2"
                            title="Start new task (⌘N)"
                        >
                            <span>Start new task</span>
                            <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⌘N</span>
                        </button>
                        <button 
                            onClick={handleCreateDraft} 
                            className="bg-amber-800/40 hover:bg-amber-700/40 text-sm px-3 py-1.5 rounded group flex items-center justify-between gap-2 border border-amber-700/40"
                            title="Create draft (⇧⌘N)"
                        >
                            <span>New draft</span>
                            <span className="text-xs opacity-60 group-hover:opacity-100 transition-opacity">⇧⌘N</span>
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex gap-4 p-6 h-full overflow-x-auto">
            <Column
                title="Draft"
                status="draft"
                sessions={sessions}
                onStatusChange={handleStatusChange}
                onCreateDraft={handleCreateDraft}
                onMarkReady={handleMarkReady}
                onUnmarkReady={handleUnmarkReady}
                onCancel={handleCancel}
                onConvertToDraft={handleConvertToDraft}
                onRunDraft={handleRunDraft}
                onDeleteDraft={handleDeleteDraft}
            />
            <Column
                title="Running"
                status="active"
                sessions={sessions}
                onStatusChange={handleStatusChange}
                onMarkReady={handleMarkReady}
                onUnmarkReady={handleUnmarkReady}
                onCancel={handleCancel}
                onConvertToDraft={handleConvertToDraft}
                onRunDraft={handleRunDraft}
                onDeleteDraft={handleDeleteDraft}
            />
            <Column
                title="Reviewed"
                status="dirty"
                sessions={sessions}
                onStatusChange={handleStatusChange}
                onMarkReady={handleMarkReady}
                onUnmarkReady={handleUnmarkReady}
                onCancel={handleCancel}
                onConvertToDraft={handleConvertToDraft}
                onRunDraft={handleRunDraft}
                onDeleteDraft={handleDeleteDraft}
            />
        </div>
    )
}