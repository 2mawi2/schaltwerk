import { memo } from 'react'
import { clsx } from 'clsx'
import { formatLastActivity } from '../../utils/time'
import { SessionActions } from '../session/SessionActions'
import { SessionInfo, SessionMonitorStatus } from '../../types/session'
import { UncommittedIndicator } from '../common/UncommittedIndicator'
import { theme } from '../../common/theme'
import type { MergeStatus } from '../../contexts/SessionsContext'
import { getSessionDisplayName } from '../../utils/sessionDisplayName'

interface SessionButtonProps {
    session: {
        info: SessionInfo
        status?: SessionMonitorStatus
        terminals: string[]
    }
    index: number
    isSelected: boolean

    hasFollowUpMessage: boolean
    isWithinVersionGroup?: boolean
    showPromoteIcon?: boolean
    willBeDeleted?: boolean
    isPromotionPreview?: boolean
    onSelect: (index: number) => void
    onMarkReady: (sessionId: string, hasUncommitted: boolean) => void
    onUnmarkReady: (sessionId: string) => void
    onCancel: (sessionId: string, hasUncommitted: boolean) => void
    onConvertToSpec?: (sessionId: string) => void
    onRunDraft?: (sessionId: string) => void
    onDeleteSpec?: (sessionId: string) => void
    onPromoteVersion?: () => void
    onPromoteVersionHover?: () => void
    onPromoteVersionHoverEnd?: () => void
    onReset?: (sessionId: string) => void
    onSwitchModel?: (sessionId: string) => void
    isResetting?: boolean
    isRunning?: boolean
    onMerge?: (sessionId: string) => void
    disableMerge?: boolean
    mergeStatus?: MergeStatus
    isMarkReadyDisabled?: boolean
}

function getSessionStateColor(state?: string): 'green' | 'violet' | 'gray' {
    switch (state) {
        case 'active': return 'green'
        case 'review':
        case 'ready': return 'violet'
        case 'stale':
        default: return 'gray'
    }
}

export const SessionButton = memo<SessionButtonProps>(({ 
    session, 
    index, 
    isSelected, 

    hasFollowUpMessage,
    isWithinVersionGroup = false,
    showPromoteIcon = false,
    willBeDeleted = false,
    isPromotionPreview = false,
    onSelect,
    onMarkReady,
    onUnmarkReady,
    onCancel,
    onConvertToSpec,
    onRunDraft,
    onDeleteSpec,
    onPromoteVersion,
    onPromoteVersionHover,
    onPromoteVersionHoverEnd,
    onReset,
    onSwitchModel,
    isResetting = false,
    isRunning = false,
    onMerge,
    disableMerge = false,
    mergeStatus = 'idle',
    isMarkReadyDisabled = false
}) => {
    const s = session.info
    const color = getSessionStateColor(s.session_state)
    const sessionName = getSessionDisplayName(s)
    const currentAgent = s.current_task || `Working on ${sessionName}`
    const progressPercent = s.todo_percentage || 0
    const additions = s.diff_stats?.insertions || s.diff_stats?.additions || 0
    const deletions = s.diff_stats?.deletions || 0
    const filesChanged = s.diff_stats?.files_changed || 0
    const lastActivity = formatLastActivity(s.last_modified)
    const isBlocked = s.is_blocked || false
    const isReadyToMerge = s.ready_to_merge || false
    const agentType = s.original_agent_type as (SessionInfo['original_agent_type'])
    const agentKey = (agentType || '').toLowerCase()
    const agentLabel = agentKey
    const agentColor = agentKey === 'claude' ? 'blue' : agentKey === 'opencode' ? 'green' : agentKey === 'gemini' ? 'orange' : agentKey === 'codex' ? 'red' : ''
    
    const sessionState = s.session_state
    const showReviewedDirtyBadge = isReadyToMerge && !isRunning && !!s.has_uncommitted_changes
    
    // State icon removed - no longer using emojis

    // Get background color based on state
    const getStateBackground = () => {
        if (willBeDeleted) {
            // Sessions that will be deleted: faded with red tint
            return 'border-red-600/50 bg-red-950/20 opacity-30 transition-all duration-200'
        }
        if (isPromotionPreview) {
            // Selected session being promoted: green emphasis
            return 'session-ring session-ring-green border-transparent shadow-lg shadow-green-400/20'
        }
        if (isSelected) return 'session-ring session-ring-blue border-transparent'
        if (isReadyToMerge) return 'session-ring session-ring-green border-transparent opacity-90'
        if (sessionState === 'running') return 'border-slate-700 bg-slate-800/50 hover:bg-slate-800/60'
        if (sessionState === 'spec') return 'border-slate-800 bg-slate-900/30 hover:bg-slate-800/30 opacity-85'
        return 'border-slate-800 bg-slate-900/40 hover:bg-slate-800/30'
    }

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onSelect(index)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(index)
                }
            }}
            data-session-id={session.info.session_id}
            data-session-selected={isSelected ? 'true' : 'false'}
            className={clsx(
                'group w-full text-left px-3 py-2.5 rounded-md mb-2 border transition-all duration-300 cursor-pointer',
                getStateBackground(),

                hasFollowUpMessage && !isSelected &&
                     'ring-2 ring-blue-400/50 shadow-lg shadow-blue-400/20 bg-blue-950/20',
                 isRunning && !isSelected &&
                     'ring-2 ring-pink-500/50 shadow-lg shadow-pink-500/20 bg-pink-950/20'
            )}
            title={isSelected 
                ? `Selected session • Diff: ⌘G • Cancel: ⌘D (⇧⌘D force) • Mark Reviewed: ⌘R` 
                : index < 8 
                    ? `Select session (⌘${index + 2})` 
                    : `Select session`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-100 truncate flex items-center gap-2">
                        {sessionName}
                        {isReadyToMerge && (
                            <span className="ml-2 text-xs text-green-400">
                                ✓ Reviewed
                            </span>
                        )}
                        {/* State pill */}
                         {isRunning && (
                             <span className={clsx(
                                 'text-[10px] px-1.5 py-0.5 rounded border ml-2'
                             )}
                             style={{
                                 backgroundColor: theme.colors.accent.magenta.bg,
                                 color: theme.colors.accent.magenta.DEFAULT,
                                 borderColor: theme.colors.accent.magenta.border
                             }}
                             >
                                 Running
                             </span>
                         )}
                        {!isReadyToMerge && !isRunning && sessionState === 'spec' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-900/30 text-amber-300 border-amber-700/50">
                                Spec
                            </span>
                        )}
                        {isBlocked && <span className="ml-2 text-xs text-red-400">⚠ blocked</span>}

                        {showReviewedDirtyBadge && (
                            <UncommittedIndicator
                                className="ml-2"
                                sessionName={sessionName}
                                samplePaths={s.top_uncommitted_paths}
                            />
                        )}

                        {hasFollowUpMessage && !isReadyToMerge && (
                            <span className="ml-2 inline-flex items-center gap-1" title="New follow-up message received">
                                <span className="flex h-4 w-4 relative">
                                    <span className="absolute inline-flex h-full w-full rounded-full opacity-75"
                                          style={{ backgroundColor: theme.colors.accent.blue.light }}></span>
                                    <span className="relative inline-flex rounded-full h-4 w-4 text-white text-[9px] items-center justify-center font-bold"
                                          style={{ backgroundColor: theme.colors.accent.blue.DEFAULT }}>!</span>
                                </span>
                            </span>
                        )}

                        {s.attention_required && (
                            <span className="ml-2 text-xs text-yellow-400">
                                ⏸ Idle
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-start gap-2 flex-shrink-0">
                    {index < 8 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                            ⌘{index + 2}
                        </span>
                    )}
                </div>
            </div>
            {sessionState !== 'spec' && (
                <div className="flex items-center justify-between gap-2 -mt-0.5">
                    <div className="text-[11px] text-slate-400 truncate max-w-[50%]">{s.branch}</div>
                    <div className="flex items-center gap-2">
                        <SessionActions
                            sessionState={sessionState as 'spec' | 'running' | 'reviewed'}
                            isReadyToMerge={isReadyToMerge}
                            sessionId={s.session_id}
                            sessionSlug={s.session_id}
                            worktreePath={s.worktree_path}
                            branch={s.branch}
                            defaultBranch={s.parent_branch ?? undefined}
                            showPromoteIcon={showPromoteIcon}
                            onRunSpec={onRunDraft}
                            onDeleteSpec={onDeleteSpec}
                            onMarkReviewed={onMarkReady}
                            onUnmarkReviewed={onUnmarkReady}
                            onCancel={onCancel}
                            onConvertToSpec={onConvertToSpec}
                            onPromoteVersion={onPromoteVersion}
                            onPromoteVersionHover={onPromoteVersionHover}
                            onPromoteVersionHoverEnd={onPromoteVersionHoverEnd}
                            onReset={onReset}
                            onSwitchModel={onSwitchModel}
                            isResetting={isResetting}
                            onMerge={onMerge}
                            disableMerge={disableMerge}
                            mergeStatus={mergeStatus}
                            mergeConflictingPaths={s.merge_conflicting_paths}
                            isMarkReadyDisabled={isMarkReadyDisabled}
                        />
                    </div>
                </div>
            )}
            {sessionState === 'spec' && (
                <div className="flex items-center justify-end -mt-0.5">
                    <SessionActions
                        sessionState={sessionState as 'spec' | 'running' | 'reviewed'}
                        isReadyToMerge={isReadyToMerge}
                        sessionId={s.session_id}
                        sessionSlug={s.session_id}
                        worktreePath={s.worktree_path}
                        branch={s.branch}
                        defaultBranch={s.parent_branch ?? undefined}
                        showPromoteIcon={showPromoteIcon}
                        onRunSpec={onRunDraft}
                        onDeleteSpec={onDeleteSpec}
                        onMarkReviewed={onMarkReady}
                        onUnmarkReviewed={onUnmarkReady}
                        onCancel={onCancel}
                        onConvertToSpec={onConvertToSpec}
                        onPromoteVersion={onPromoteVersion}
                        onPromoteVersionHover={onPromoteVersionHover}
                        onPromoteVersionHoverEnd={onPromoteVersionHoverEnd}
                        onReset={onReset}
                        onSwitchModel={onSwitchModel}
                        isResetting={isResetting}
                        onMerge={onMerge}
                        disableMerge={disableMerge}
                        mergeStatus={mergeStatus}
                        mergeConflictingPaths={s.merge_conflicting_paths}
                        isMarkReadyDisabled={isMarkReadyDisabled}
                    />
                </div>
            )}
            <div className="mt-2 text-[12px] text-slate-400 truncate">{currentAgent}</div>
            {progressPercent > 0 && (
                <>
                    <div className="mt-3 h-2 bg-slate-800 rounded">
                        <div className={clsx('h-2 rounded',
                            color === 'green' && 'bg-green-500',
                            color === 'violet' && 'bg-violet-500',
                            color === 'gray' && 'bg-slate-500')}
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
                    {agentType && sessionState !== 'spec' && !isWithinVersionGroup && (
                        <span
                             className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10px] border leading-none"
                             style={{
                               backgroundColor: agentColor === 'blue' ? theme.colors.accent.blue.bg :
                                               agentColor === 'green' ? theme.colors.accent.green.bg :
                                               agentColor === 'orange' ? theme.colors.accent.amber.bg :
                                               theme.colors.accent.red.bg,
                               color: agentColor === 'blue' ? theme.colors.accent.blue.light :
                                     agentColor === 'green' ? theme.colors.accent.green.light :
                                     agentColor === 'orange' ? theme.colors.accent.amber.light :
                                     theme.colors.accent.red.light,
                               borderColor: agentColor === 'blue' ? theme.colors.accent.blue.border :
                                           agentColor === 'green' ? theme.colors.accent.green.border :
                                           agentColor === 'orange' ? theme.colors.accent.amber.border :
                                           theme.colors.accent.red.border
                             }}
                            title={`Agent: ${agentLabel}`}
                        >
                             <span className="w-1 h-1 rounded-full"
                               style={{
                                 backgroundColor: agentColor === 'blue' ? theme.colors.accent.blue.DEFAULT :
                                                 agentColor === 'green' ? theme.colors.accent.green.DEFAULT :
                                                 agentColor === 'orange' ? theme.colors.accent.amber.DEFAULT :
                                                 theme.colors.accent.red.DEFAULT
                               }} />
                            {agentLabel}
                        </span>
                    )}
                    <div>Last: {lastActivity}</div>
                </div>
            </div>
        </div>
    )
})
