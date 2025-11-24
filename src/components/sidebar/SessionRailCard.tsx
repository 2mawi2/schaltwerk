import { memo } from 'react'
import { clsx } from 'clsx'
import { SessionInfo, SessionMonitorStatus, SessionState } from '../../types/session'
import { getSessionDisplayName } from '../../utils/sessionDisplayName'
import { mapSessionUiState } from '../../utils/sessionFilters'
import { theme } from '../../common/theme'
import { typography } from '../../common/typography'
import { getSessionCardSurfaceClasses } from './SessionCard'
import { ProgressIndicator } from '../common/ProgressIndicator'
import { useMultipleShortcutDisplays } from '../../keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { detectPlatformSafe } from '../../keyboardShortcuts/helpers'

interface SessionRailCardProps {
  session: {
    info: SessionInfo
    status?: SessionMonitorStatus
    terminals: string[]
  }
  index: number
  isSelected: boolean
  hasFollowUpMessage: boolean
  isRunning: boolean
  onSelect: (index: number) => void
}

export const SessionRailCard = memo<SessionRailCardProps>(function SessionRailCard({
  session,
  index,
  isSelected,
  hasFollowUpMessage,
  isRunning,
  onSelect,
}) {
  const info = session.info
  const sessionName = getSessionDisplayName(info)
  const sessionState = info.session_state
  const stateLabel = mapSessionUiState(info)
  const isIdle = Boolean((info as SessionInfo & { attention_required?: boolean }).attention_required)
  const isRunningState = stateLabel === 'running' && !isIdle
  const accessibleState = isIdle ? 'idle' : stateLabel
  const shortcuts = useMultipleShortcutDisplays([
    KeyboardShortcutAction.SwitchToSession1,
    KeyboardShortcutAction.SwitchToSession2,
    KeyboardShortcutAction.SwitchToSession3,
    KeyboardShortcutAction.SwitchToSession4,
    KeyboardShortcutAction.SwitchToSession5,
    KeyboardShortcutAction.SwitchToSession6,
    KeyboardShortcutAction.SwitchToSession7,
    KeyboardShortcutAction.SwitchToSession8,
  ])
  const platform = detectPlatformSafe()
  const modKey = platform === 'mac' ? '⌘' : 'Ctrl'
  const sessionActions = [
    KeyboardShortcutAction.SwitchToSession1,
    KeyboardShortcutAction.SwitchToSession2,
    KeyboardShortcutAction.SwitchToSession3,
    KeyboardShortcutAction.SwitchToSession4,
    KeyboardShortcutAction.SwitchToSession5,
    KeyboardShortcutAction.SwitchToSession6,
    KeyboardShortcutAction.SwitchToSession7,
    KeyboardShortcutAction.SwitchToSession8,
  ]
  const getShortcutLabel = (idx: number) => {
    if (idx >= sessionActions.length) return null
    const action = sessionActions[idx]
    return shortcuts[action] || `${modKey}${idx + 2}`
  }
  const shortcutLabel = getShortcutLabel(index)

  const additions = info.diff_stats?.insertions || info.diff_stats?.additions || 0
  const deletions = info.diff_stats?.deletions || 0

  const surfaceClasses = getSessionCardSurfaceClasses({
    sessionState,
    isSelected,
    isReviewedState: sessionState === 'reviewed',
    isRunning,
    hasFollowUpMessage,
  })

  return (
    <div
      role="button"
      tabIndex={0}
      data-session-id={info.session_id}
      data-session-selected={isSelected ? 'true' : 'false'}
      title={`${shortcutLabel ? `[${shortcutLabel}] ` : ''}${sessionName} • ${accessibleState} • +${additions} -${deletions}`}
      aria-label={`${sessionName} (${accessibleState})`}
      className={clsx(
        'group relative w-full rounded-md mb-1 border transition-all duration-200',
        'flex flex-col items-center gap-1.5 px-1.5 py-1.5',
        surfaceClasses,
        'cursor-pointer'
      )}
      onClick={() => onSelect(index)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(index)
        }
      }}
    >
      <div className="flex flex-col items-center gap-1 w-full">
        {/* Shortcut badge */}
        <div className="flex items-center justify-center w-full">
          {shortcutLabel && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded bg-slate-700/60"
              style={{ color: theme.colors.text.secondary }}
            >
              {shortcutLabel}
            </span>
          )}
        </div>

        {/* State icon row */}
        <div className="flex items-center justify-center w-full">
          {isRunningState && <ProgressIndicator className="scale-75" size="sm" />}
          {!isRunningState && isIdle && (
          <span
            style={{
              fontSize: theme.fontSize.label,
              lineHeight: theme.lineHeight.compact,
              fontFamily: theme.fontFamily.sans,
              fontWeight: 600,
              color: theme.colors.accent.yellow.light
            }}
            title="Idle"
          >
            ⏸ Idle
          </span>
          )}
          {!isRunningState && !isIdle && stateLabel === SessionState.Spec && (
            <span
              className="block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: theme.colors.accent.yellow.DEFAULT }}
              title="Spec"
            />
          )}
          {!isRunningState && !isIdle && stateLabel === SessionState.Reviewed && (
            <span
              className="font-bold"
              style={{ color: theme.colors.accent.green.light, fontSize: theme.fontSize.caption }}
              title="Ready"
            >
              ✓
            </span>
          )}
          {!isRunningState && !isIdle && stateLabel === SessionState.Running && (
            <span
              className="block w-1 h-1 rounded-full opacity-40"
              style={{ backgroundColor: theme.colors.text.tertiary }}
              title="Idle"
            />
          )}
        </div>

        {/* Diff summary */}
        <div
          className="flex flex-col items-center justify-center gap-0.8 w-full"
          style={{ ...typography.caption, fontSize: theme.fontSize.label, color: theme.colors.text.secondary }}
        >
          <span style={{ color: theme.colors.accent.green.light }}>+{additions}</span>
          <span style={{ color: theme.colors.accent.red.light }}>-{deletions}</span>
        </div>

        {/* No branch/name text in rail */}
      </div>
    </div>
  )
})
