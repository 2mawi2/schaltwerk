import { memo, forwardRef } from 'react'
import { clsx } from 'clsx'
import { formatLastActivity } from '../../utils/time'

interface DiffStats {
    files_changed: number
    additions: number
    deletions: number
    insertions: number
}

interface SessionInfo {
    session_id: string
    display_name?: string
    branch: string
    worktree_path: string
    base_branch: string
    merge_mode: string
    status: 'active' | 'dirty' | 'missing' | 'archived' | 'draft'
    created_at?: string
    last_modified?: string
    has_uncommitted_changes?: boolean
    is_current: boolean
    session_type: 'worktree' | 'container'
    container_status?: string
    session_state?: string
    current_task?: string
    todo_percentage?: number
    is_blocked?: boolean
    diff_stats?: DiffStats
    ready_to_merge?: boolean
}

export interface SessionCardProps {
    session: {
        info: SessionInfo
        status?: any
        terminals: string[]
    }
    isSelected?: boolean
    isDragging?: boolean
    hideKeyboardShortcut?: boolean
    hideActions?: boolean
    onSelect?: () => void
    onMarkReady?: (sessionId: string, hasUncommitted: boolean) => void
    onUnmarkReady?: (sessionId: string) => void
    onCancel?: (sessionId: string, hasUncommitted: boolean) => void
    onConvertToDraft?: (sessionId: string) => void
    onRunDraft?: (sessionId: string) => void
    onDeleteDraft?: (sessionId: string) => void
    className?: string
    index?: number
}

export const SessionCard = memo(forwardRef<HTMLDivElement, SessionCardProps>(({
    session,
    isSelected = false,
    isDragging = false,
    hideKeyboardShortcut = false,
    hideActions = false,
    onSelect,
    onMarkReady,
    onUnmarkReady,
    onCancel,
    onConvertToDraft,
    onRunDraft,
    onDeleteDraft,
    className,
    index
}, ref) => {
    const s = session.info
    const sessionName = s.display_name || s.session_id
    const task = s.current_task || `Working on ${sessionName}`
    const progressPercent = s.todo_percentage || 0
    const additions = s.diff_stats?.insertions || s.diff_stats?.additions || 0
    const deletions = s.diff_stats?.deletions || 0
    const filesChanged = s.diff_stats?.files_changed || 0
    const lastActivity = formatLastActivity(s.last_modified)
    const isBlocked = s.is_blocked || false
    const isReadyToMerge = s.ready_to_merge || false
    
    // Determine session state
    const sessionState = isReadyToMerge ? 'reviewed' : 
                        s.status === 'draft' ? 'draft' :
                        s.session_state === 'draft' ? 'draft' : 'running'
    
    // Get background color based on state
    const getStateBackground = () => {
        if (isDragging) return 'opacity-50'
        if (isSelected) return 'session-ring session-ring-blue border-transparent'
        if (isReadyToMerge) return 'session-ring session-ring-green border-transparent opacity-90'
        if (sessionState === 'running') return 'border-slate-700 bg-slate-800/50 hover:bg-slate-800/60'
        if (sessionState === 'draft') return 'border-slate-800 bg-slate-900/30 hover:bg-slate-800/30 opacity-85'
        return 'border-slate-800 bg-slate-900/40 hover:bg-slate-800/30'
    }

    const cardContent = (
        <>
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-100 truncate flex items-center gap-2">
                        {sessionName}
                        {isReadyToMerge && (
                            <span className="ml-2 text-xs text-green-400">
                                ✓ Reviewed
                            </span>
                        )}
                        {!isReadyToMerge && (
                            <span
                                className={clsx(
                                    'text-[10px] px-1.5 py-0.5 rounded border',
                                    sessionState === 'running'
                                        ? 'bg-green-900/30 text-green-300 border-green-700/50'
                                        : 'bg-amber-900/30 text-amber-300 border-amber-700/50'
                                )}
                            >
                                {sessionState === 'running' ? 'Running' : 'Draft'}
                            </span>
                        )}
                        {isBlocked && <span className="ml-2 text-xs text-red-400">⚠ blocked</span>}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">{s.branch}</div>
                </div>
                {!hideKeyboardShortcut && index !== undefined && index < 8 && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                            ⌘{index + 2}
                        </span>
                    </div>
                )}
            </div>
            
            {!hideActions && (
                <div className="-mt-4 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity whitespace-nowrap">
                    {sessionState === 'draft' ? (
                        <span 
                            onClick={(e) => {
                                e.stopPropagation()
                                if (onRunDraft) {
                                    onRunDraft(s.session_id)
                                }
                            }}
                            className="inline-block cursor-pointer text-[11px] px-2 py-0.5 rounded bg-green-800/60 hover:bg-green-700/60"
                            title="Run task"
                        >
                            Run
                        </span>
                    ) : (
                        <>
                            {!isReadyToMerge ? (
                                <span 
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onMarkReady?.(s.session_id, s.has_uncommitted_changes || false)
                                    }}
                                    className="inline-block cursor-pointer text-[11px] px-2 py-0.5 rounded bg-green-800/60 hover:bg-green-700/60"
                                    title="Mark as reviewed"
                                >
                                    Mark Reviewed
                                </span>
                            ) : (
                                <span 
                                    onClick={async (e) => {
                                        e.stopPropagation()
                                        onUnmarkReady?.(s.session_id)
                                    }}
                                    className="inline-block cursor-pointer text-[11px] px-2 py-0.5 rounded bg-slate-700/60 hover:bg-slate-600/60"
                                    title="Unmark as reviewed"
                                >
                                    Unmark
                                </span>
                            )}
                            <span 
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onConvertToDraft?.(s.session_id)
                                }}
                                className="inline-block cursor-pointer text-[11px] px-2 py-0.5 rounded bg-amber-800/60 hover:bg-amber-700/60"
                                title="Convert back to draft"
                            >
                                Draft
                            </span>
                            <span 
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onCancel?.(s.session_id, s.has_uncommitted_changes || false)
                                }}
                                className="inline-block cursor-pointer text-[11px] px-2 py-0.5 rounded bg-red-800/60 hover:bg-red-700/60"
                                title="Cancel session"
                            >
                                Cancel
                            </span>
                        </>
                    )}
                    {sessionState === 'draft' && (
                        <span
                            onClick={(e) => {
                                e.stopPropagation()
                                onDeleteDraft?.(s.session_id)
                            }}
                            className="inline-block cursor-pointer text-[11px] px-2 py-0.5 rounded bg-red-900/60 hover:bg-red-800/60"
                            title="Delete draft"
                        >
                            Delete
                        </span>
                    )}
                </div>
            )}
            
            <div className="mt-1 text-[12px] text-slate-400 truncate">{task}</div>
            
            {progressPercent > 0 && (
                <>
                    <div className="mt-3 h-2 bg-slate-800 rounded">
                        <div className={clsx('h-2 rounded bg-green-500')}
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">{progressPercent}% complete</div>
                </>
            )}
            
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                <div>
                    {filesChanged > 0 && <span>{filesChanged} files, </span>}
                    <span className="text-green-400">+{additions}</span>{' '}
                    <span className="text-red-400">-{deletions}</span>
                </div>
                <div>Last: {lastActivity}</div>
            </div>
        </>
    )

    if (onSelect) {
        return (
            <button
                ref={ref as any}
                onClick={onSelect}
                className={clsx(
                    'group w-full text-left px-3 py-2.5 rounded-md border transition-all duration-300',
                    getStateBackground(),
                    className
                )}
            >
                {cardContent}
            </button>
        )
    }

    return (
        <div
            ref={ref}
            className={clsx(
                'group w-full text-left px-3 py-2.5 rounded-md border transition-all duration-300',
                getStateBackground(),
                className
            )}
        >
            {cardContent}
        </div>
    )
}))