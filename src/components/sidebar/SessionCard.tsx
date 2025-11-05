import { memo } from 'react'
import { clsx } from 'clsx'
import { formatLastActivity } from '../../utils/time'
import { SessionActions } from '../session/SessionActions'
import { SessionInfo, SessionMonitorStatus } from '../../types/session'
import { UncommittedIndicator } from '../common/UncommittedIndicator'
import { ProgressIndicator } from '../common/ProgressIndicator'
import { theme, getAgentColorScheme } from '../../common/theme'
import { typography } from '../../common/typography'
import type { MergeStatus } from '../../store/atoms/sessions'
import { getSessionDisplayName } from '../../utils/sessionDisplayName'
import { useMultipleShortcutDisplays } from '../../keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { detectPlatformSafe } from '../../keyboardShortcuts/helpers'

interface SessionCardProps {
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
    onRefineSpec?: (sessionId: string) => void
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
    isBusy?: boolean
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

const sessionText = {
    title: {
        ...typography.heading,
        fontWeight: 600,
        color: theme.colors.text.primary,
    },
    badge: {
        ...typography.caption,
        fontWeight: 600,
        lineHeight: theme.lineHeight.compact,
    },
    meta: {
        ...typography.caption,
        color: theme.colors.text.tertiary,
    },
    metaEmphasis: {
        ...typography.caption,
        color: theme.colors.text.secondary,
    },
    agent: {
        ...typography.body,
        color: theme.colors.text.secondary,
    },
    agentMuted: {
        ...typography.caption,
        color: theme.colors.text.secondary,
    },
    statsLabel: {
        ...typography.caption,
        color: theme.colors.text.tertiary,
    },
    statsNumber: {
        ...typography.caption,
        fontWeight: 600,
    },
}

export const SessionCard = memo<SessionCardProps>(({ 
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
    onRefineSpec,
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
    isMarkReadyDisabled = false,
    isBusy = false
}) => {
    const shortcuts = useMultipleShortcutDisplays([
        KeyboardShortcutAction.OpenDiffViewer,
        KeyboardShortcutAction.CancelSession,
        KeyboardShortcutAction.MarkSessionReady,
        KeyboardShortcutAction.SwitchToSession1,
        KeyboardShortcutAction.SwitchToSession2,
        KeyboardShortcutAction.SwitchToSession3,
        KeyboardShortcutAction.SwitchToSession4,
        KeyboardShortcutAction.SwitchToSession5,
        KeyboardShortcutAction.SwitchToSession6,
        KeyboardShortcutAction.SwitchToSession7,
        KeyboardShortcutAction.ForceCancelSession
    ])
    const platform = detectPlatformSafe()
    const modKey = platform === 'mac' ? '⌘' : 'Ctrl'
    const shiftModKey = platform === 'mac' ? '⇧⌘' : 'Ctrl+Shift'

    const getAccessibilityLabel = (isSelected: boolean, index: number) => {
        if (isSelected) {
            return `Selected session • Diff: ${shortcuts[KeyboardShortcutAction.OpenDiffViewer] || `${modKey}G`} • Cancel: ${shortcuts[KeyboardShortcutAction.CancelSession] || `${modKey}D`} (${shortcuts[KeyboardShortcutAction.ForceCancelSession] || `${shiftModKey}D`} force) • Mark Reviewed: ${shortcuts[KeyboardShortcutAction.MarkSessionReady] || `${modKey}R`}`
        }
        if (index < 8) {
            const sessionActions = [
                KeyboardShortcutAction.SwitchToSession1,
                KeyboardShortcutAction.SwitchToSession2,
                KeyboardShortcutAction.SwitchToSession3,
                KeyboardShortcutAction.SwitchToSession4,
                KeyboardShortcutAction.SwitchToSession5,
                KeyboardShortcutAction.SwitchToSession6,
                KeyboardShortcutAction.SwitchToSession7
            ]
            const sessionAction = sessionActions[index]
            return `Select session (${shortcuts[sessionAction] || `${modKey}${index + 2}`})`
        }
        return 'Select session'
    }
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

    const getAgentColor = (agent: string): 'blue' | 'green' | 'orange' | 'violet' | 'red' | 'yellow' => {
        switch (agent) {
            case 'claude': return 'blue'
            case 'opencode': return 'green'
            case 'gemini': return 'orange'
            case 'droid': return 'violet'
            case 'codex': return 'red'
            case 'amp': return 'yellow'
            default: return 'red'
        }
    }

    const agentColor = getAgentColor(agentKey)
    const colorScheme = getAgentColorScheme(agentColor)

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
            tabIndex={isBusy ? -1 : 0}
            aria-disabled={isBusy}
            aria-busy={isBusy}
            onClick={() => {
                if (isBusy) return
                onSelect(index)
            }}
            onKeyDown={(e) => {
                if (isBusy) return
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(index)
                }
            }}
            data-session-id={session.info.session_id}
            data-session-selected={isSelected ? 'true' : 'false'}
            className={clsx(
                'group relative w-full text-left px-3 py-2.5 rounded-md mb-2 border transition-all duration-300',
                getStateBackground(),

                hasFollowUpMessage && !isSelected &&
                     'ring-2 ring-blue-400/50 shadow-lg shadow-blue-400/20 bg-blue-950/20',
                 isRunning && !isSelected &&
                     'ring-2 ring-pink-500/50 shadow-lg shadow-pink-500/20 bg-pink-950/20',
                isBusy ? 'cursor-progress opacity-60' : 'cursor-pointer'
            )}
            aria-label={getAccessibilityLabel(isSelected, index)}
        >
            {isBusy && (
                <div
                    className="absolute inset-0 z-10 flex items-center justify-center rounded-md pointer-events-none"
                    data-testid="session-busy-indicator"
                    style={{
                        backgroundColor: theme.colors.background.primary,
                        opacity: 0.72
                    }}
                >
                    <span
                        className="h-4 w-4 border-2 border-solid rounded-full animate-spin"
                        style={{
                            borderColor: theme.colors.accent.blue.border,
                            borderTopColor: 'transparent'
                        }}
                    />
                </div>
            )}
            <div className="flex items-start justify-between gap-2" style={{ marginBottom: '8px' }}>
                <div className="flex-1 min-w-0">
                    <div className="truncate flex items-center gap-2" style={sessionText.title}>
                        {sessionName}
                        {isReadyToMerge && (
                            <span
                                className="ml-2"
                                style={{
                                    ...sessionText.badge,
                                    color: theme.colors.accent.green.light,
                                }}
                            >
                                ✓ Reviewed
                            </span>
                        )}
                        {/* State pill */}
                         {isRunning && isReadyToMerge && (
                             <span
                                 className="ml-2 px-1.5 py-0.5 rounded border"
                                 style={{
                                     ...sessionText.badge,
                                     backgroundColor: theme.colors.accent.magenta.bg,
                                     color: theme.colors.accent.magenta.DEFAULT,
                                     borderColor: theme.colors.accent.magenta.border
                                 }}
                             >
                                 Running
                             </span>
                         )}
                        {!isReadyToMerge && !isRunning && sessionState === 'spec' && (
                            <span
                                className="px-1.5 py-0.5 rounded border"
                                style={{
                                    ...sessionText.badge,
                                    backgroundColor: theme.colors.accent.amber.bg,
                                    color: theme.colors.accent.amber.light,
                                    borderColor: theme.colors.accent.amber.border
                                }}
                            >
                                Spec
                            </span>
                        )}
                        {isBlocked && (
                            <span
                                className="ml-2"
                                style={{
                                    ...sessionText.badge,
                                    color: theme.colors.accent.red.light,
                                }}
                            >
                                ⚠ blocked
                            </span>
                        )}

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
                                    <span className="relative inline-flex rounded-full h-4 w-4 text-white items-center justify-center font-bold"
                                          style={{
                                              ...sessionText.badge,
                                              fontSize: theme.fontSize.caption,
                                              backgroundColor: theme.colors.accent.blue.DEFAULT
                                          }}>!</span>
                                </span>
                            </span>
                        )}

                        {!s.attention_required && sessionState === 'running' && !isReadyToMerge && (
                            <ProgressIndicator className="ml-2" size="sm" />
                        )}

                        {s.attention_required && (
                            <span
                                className="ml-2"
                                style={{
                                    ...sessionText.badge,
                                    color: theme.colors.accent.yellow.light,
                                }}
                            >
                                ⏸ Idle
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-start gap-2 flex-shrink-0">
                    {index < 8 && (
                        <span
                            className="px-1.5 py-0.5 rounded bg-slate-700/50"
                            style={sessionText.meta}
                        >
                            {(() => {
                                const sessionActions = [
                                    KeyboardShortcutAction.SwitchToSession1,
                                    KeyboardShortcutAction.SwitchToSession2,
                                    KeyboardShortcutAction.SwitchToSession3,
                                    KeyboardShortcutAction.SwitchToSession4,
                                    KeyboardShortcutAction.SwitchToSession5,
                                    KeyboardShortcutAction.SwitchToSession6,
                                    KeyboardShortcutAction.SwitchToSession7
                                ]
                                const sessionAction = sessionActions[index]
                                return shortcuts[sessionAction] || `${modKey}${index + 2}`
                            })()}
                        </span>
                    )}
                </div>
            </div>
            {sessionState !== 'spec' && (
                <div className="flex items-center justify-between gap-2">
                    <div
                        className="truncate max-w-[50%]"
                        style={sessionText.meta}
                    >
                        {s.branch}
                    </div>
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
                            onRefineSpec={onRefineSpec}
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
                <div className="flex items-center justify-end">
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
                        onRefineSpec={onRefineSpec}
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
            <div className="mt-2 truncate" style={sessionText.agent}>{currentAgent}</div>
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
                    <div className="mt-1" style={sessionText.meta}>{progressPercent}% complete</div>
                </>
            )}
            <div className="mt-2 flex items-center justify-between" style={sessionText.meta}>
                <div style={sessionText.meta}>
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
                             className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded border"
                             style={{
                               ...sessionText.badge,
                               backgroundColor: colorScheme.bg,
                               color: colorScheme.light,
                               borderColor: colorScheme.border
                             }}
                            title={`Agent: ${agentLabel}`}
                        >
                             <span className="w-1 h-1 rounded-full"
                               style={{
                                 backgroundColor: colorScheme.DEFAULT
                               }} />
                            {agentLabel}
                        </span>
                    )}
                    <div style={sessionText.meta}>Last: {lastActivity}</div>
                </div>
            </div>
        </div>
    )
})
