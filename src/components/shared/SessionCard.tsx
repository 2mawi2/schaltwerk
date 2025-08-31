import { memo, forwardRef } from 'react'
import { clsx } from 'clsx'
import { formatLastActivity } from '../../utils/time'
import { SessionActions } from '../session/SessionActions'

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
    status: 'active' | 'dirty' | 'missing' | 'archived' | 'spec'
    created_at?: string
    last_modified?: string
    has_uncommitted_changes?: boolean
    is_current: boolean
    session_type: 'worktree' | 'container'
    container_status?: string
    session_state: 'spec' | 'running' | 'reviewed'
    original_agent_type?: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex'
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
    isFocused?: boolean
    isDragging?: boolean
    hideKeyboardShortcut?: boolean
    hideActions?: boolean
    onSelect?: () => void
    onMarkReady?: (sessionId: string, hasUncommitted: boolean) => void
    onUnmarkReady?: (sessionId: string) => void
    onCancel?: (sessionId: string, hasUncommitted: boolean) => void
    onConvertToSpec?: (sessionId: string) => void
    onRunDraft?: (sessionId: string) => void
    onDeleteSpec?: (sessionId: string) => void
    className?: string
    index?: number
}

export const SessionCard = memo(forwardRef<HTMLDivElement, SessionCardProps>(({
    session,
    isSelected = false,
    isFocused = false,
    isDragging = false,
    hideKeyboardShortcut = false,
    hideActions = false,
    onSelect,
    onMarkReady,
    onUnmarkReady,
    onCancel,
    onConvertToSpec,
    onRunDraft,
    onDeleteSpec,
    className,
    index
}, ref) => {
    const s = session.info
    const sessionName = s.display_name || s.session_id
    const currentAgent = s.current_task || `Working on ${sessionName}`
    const progressPercent = s.todo_percentage || 0
    const additions = s.diff_stats?.insertions || s.diff_stats?.additions || 0
    const deletions = s.diff_stats?.deletions || 0
    const filesChanged = s.diff_stats?.files_changed || 0
    const lastActivity = formatLastActivity(s.last_modified)
    const isBlocked = s.is_blocked || false
    const isReadyToMerge = s.ready_to_merge || false
    
    // Determine session state - use the backend session_state directly
    const sessionState = isReadyToMerge ? 'reviewed' : s.session_state
    
    // Get background color based on state
    const getStateBackground = () => {
        if (isDragging) return 'opacity-50'
        if (isFocused) return 'session-ring session-ring-blue border-transparent ring-2 ring-blue-500 ring-opacity-60'
        if (isSelected) return 'session-ring session-ring-blue border-transparent'
        if (isReadyToMerge) return 'session-ring session-ring-green border-transparent opacity-90'
        if (sessionState === 'running') return 'border-slate-700 bg-slate-800/50 hover:bg-slate-800/60'
        if (sessionState === 'spec') return 'border-slate-800 bg-slate-900/30 hover:bg-slate-800/30 opacity-85'
        return 'border-slate-800 bg-slate-900/40 hover:bg-slate-800/30'
    }

    const agentType = s.original_agent_type as (SessionInfo['original_agent_type'])
    const agentKey = (agentType || '').toLowerCase()
    const agentLabel = agentKey
    const agentColor = agentKey === 'claude' ? 'blue' : agentKey === 'cursor' ? 'purple' : agentKey === 'opencode' ? 'green' : agentKey === 'gemini' ? 'orange' : agentKey === 'codex' ? 'red' : ''

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
                                {sessionState === 'running' ? 'Running' : 'Spec'}
                            </span>
                        )}
                        {isBlocked && <span className="ml-2 text-xs text-red-400">⚠ blocked</span>}
                    </div>
                </div>
                {!hideKeyboardShortcut && index !== undefined && index < 8 && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                            ⌘{index + 2}
                        </span>
                    </div>
                )}
            </div>
            
            {sessionState !== 'spec' && (
                <div className="flex items-center justify-between gap-2 -mt-0.5">
                    <div className="text-[11px] text-slate-400 truncate max-w-[50%]">{s.branch}</div>
                    {!hideActions && (
                        <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                            <SessionActions
                                sessionState={sessionState as 'spec' | 'running' | 'reviewed'}
                                sessionId={s.session_id}
                                hasUncommittedChanges={s.has_uncommitted_changes}
                                branch={s.branch}
                                onRunSpec={onRunDraft}
                                onDeleteSpec={onDeleteSpec}
                                onMarkReviewed={onMarkReady}
                                onUnmarkReviewed={onUnmarkReady}
                                onCancel={onCancel}
                                onConvertToSpec={onConvertToSpec}
                            />
                        </div>
                    )}
                </div>
            )}
            
            {sessionState === 'spec' && !hideActions && (
                <div className="flex items-center justify-end -mt-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    <SessionActions
                        sessionState={sessionState as 'spec' | 'running' | 'reviewed'}
                        sessionId={s.session_id}
                        hasUncommittedChanges={s.has_uncommitted_changes}
                        branch={s.branch}
                        onRunSpec={onRunDraft}
                        onDeleteSpec={onDeleteSpec}
                        onMarkReviewed={onMarkReady}
                        onUnmarkReviewed={onUnmarkReady}
                        onCancel={onCancel}
                        onConvertToSpec={onConvertToSpec}
                    />
                </div>
            )}
            
            <div className="mt-2 text-[12px] text-slate-400 truncate">{currentAgent}</div>
            
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
                    {sessionState !== 'spec' && (
                        <>
                            {filesChanged > 0 && <span>{filesChanged} files, </span>}
                            <span className="text-green-400">+{additions}</span>{' '}
                            <span className="text-red-400">-{deletions}</span>
                        </>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {agentType && sessionState !== 'spec' && (
                        <span
                            className={clsx(
                                'inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10px] border leading-none',
                                agentColor === 'blue' && 'bg-blue-900/30 text-blue-300 border-blue-700/50',
                                agentColor === 'purple' && 'bg-purple-900/30 text-purple-300 border-purple-700/50',
                                agentColor === 'green' && 'bg-green-900/30 text-green-300 border-green-700/50',
                                agentColor === 'orange' && 'bg-orange-900/30 text-orange-300 border-orange-700/50',
                                agentColor === 'red' && 'bg-red-900/30 text-red-300 border-red-700/50'
                            )}
                            title={`Agent: ${agentLabel}`}
                        >
                            <span className={clsx(
                                'w-1 h-1 rounded-full',
                                agentColor === 'blue' && 'bg-blue-500',
                                agentColor === 'purple' && 'bg-purple-500',
                                agentColor === 'green' && 'bg-green-500',
                                agentColor === 'orange' && 'bg-orange-500',
                                agentColor === 'red' && 'bg-red-500'
                            )} />
                            {agentLabel}
                        </span>
                    )}
                    <div>Last: {lastActivity}</div>
                </div>
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
