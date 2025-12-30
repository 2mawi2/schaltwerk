import { memo, useState } from 'react'
import { clsx } from 'clsx'
import { SessionCard } from './SessionCard'
import { SessionVersionGroup as SessionVersionGroupType } from '../../utils/sessionVersions'
import { isSpec, mapSessionUiState } from '../../utils/sessionFilters'
import { SessionSelection } from '../../hooks/useSessionManagement'
import { ProgressIndicator } from '../common/ProgressIndicator'
import type { MergeStatus } from '../../store/atoms/sessions'

interface SessionVersionGroupProps {
  group: SessionVersionGroupType
  selection: {
    kind: string
    payload?: string
  }
  startIndex: number  // The starting index of this group in the overall sessions list

  hasFollowUpMessage: (sessionId: string) => boolean
  onSelect: (sessionId: string) => void
  onMarkReady: (sessionId: string) => void
  onUnmarkReady: (sessionId: string) => void
  onCancel: (sessionId: string, hasUncommitted: boolean) => void
  onConvertToSpec?: (sessionId: string) => void
  onRunDraft?: (sessionId: string) => void
  onRefineSpec?: (sessionId: string) => void
  onDeleteSpec?: (sessionId: string) => void
  onSelectBestVersion?: (groupBaseName: string, selectedSessionId: string) => void
  onReset?: (sessionId: string) => void
  onSwitchModel?: (sessionId: string) => void
  onCreatePullRequest?: (sessionId: string) => void
  resettingSelection?: SessionSelection | null
  isInSpecMode?: boolean  // Optional: whether we're in spec mode
  currentSpecId?: string | null  // Optional: current spec selected in spec mode
  isSessionRunning?: (sessionId: string) => boolean  // Function to check if a session is running
  onMerge?: (sessionId: string) => void
  onQuickMerge?: (sessionId: string) => void
  isMergeDisabled?: (sessionId: string) => boolean
  getMergeStatus?: (sessionId: string) => MergeStatus
  isMarkReadyDisabled?: boolean
  isSessionBusy?: (sessionId: string) => boolean
  onRename?: (sessionId: string, newName: string) => Promise<void>
  onLinkPr?: (sessionId: string, prNumber: number, prUrl: string) => void
}

export const SessionVersionGroup = memo<SessionVersionGroupProps>(({
  group,
  selection,
  startIndex,

  hasFollowUpMessage,
  onSelect,
  onMarkReady,
  onUnmarkReady,
  onCancel,
  onConvertToSpec,
  onRunDraft,
  onRefineSpec,
  onDeleteSpec,
  onSelectBestVersion,
  onReset,
  onSwitchModel,
  onCreatePullRequest,
  resettingSelection,
  isInSpecMode,
  currentSpecId,
  isSessionRunning,
  onMerge,
  onQuickMerge,
  isMergeDisabled,
  getMergeStatus,
  isMarkReadyDisabled = false,
  isSessionBusy,
  onRename,
  onLinkPr
}) => {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isPreviewingDeletion, setIsPreviewingDeletion] = useState(false)

   // If it's not a version group, render the single session normally
   if (!group.isVersionGroup) {
     const session = group.versions[0]
     // Check if this session is selected either as a normal session or as a spec in spec mode
      const isSelected = (selection.kind === 'session' && selection.payload === session.session.info.session_id) ||
                          (isInSpecMode === true && isSpec(session.session.info) && currentSpecId === session.session.info.session_id)

    const isResettingForSession = resettingSelection?.kind === 'session'
      && resettingSelection.payload === session.session.info.session_id

    return (
      <SessionCard
        session={session.session}
        index={startIndex}
        isSelected={isSelected}

        hasFollowUpMessage={hasFollowUpMessage(session.session.info.session_id)}
        isWithinVersionGroup={false}
        showPromoteIcon={false}
        onSelect={onSelect}
        onMarkReady={onMarkReady}
        onUnmarkReady={onUnmarkReady}
        onCancel={onCancel}
        onConvertToSpec={onConvertToSpec}
        onRunDraft={onRunDraft}
        onRefineSpec={onRefineSpec}
        onDeleteSpec={onDeleteSpec}
        onReset={onReset}
        onSwitchModel={onSwitchModel}
        onCreatePullRequest={onCreatePullRequest}
        isResetting={isResettingForSession}
        isRunning={isSessionRunning?.(session.session.info.session_id) || false}
        onMerge={onMerge}
        onQuickMerge={onQuickMerge}
        disableMerge={isMergeDisabled?.(session.session.info.session_id) || false}
        mergeStatus={getMergeStatus?.(session.session.info.session_id) ?? 'idle'}
        isMarkReadyDisabled={isMarkReadyDisabled}
        isBusy={isSessionBusy?.(session.session.info.session_id) ?? false}
        onRename={onRename}
        onLinkPr={onLinkPr}
      />
    )
  }

  // Check if any version in the group is selected
  const selectedVersionInGroup = group.versions.find(
    v => selection.kind === 'session' && selection.payload === v.session.info.session_id
  )
  const hasSelectedVersion = !!selectedVersionInGroup

  const versionStatusSummary = group.versions.reduce<{ active: number; idle: number }>((acc, version) => {
    const info = version.session.info
    const uiState = mapSessionUiState(info)
    if (info.attention_required) {
      acc.idle += 1
    } else if (uiState === 'running') {
      acc.active += 1
    }
    return acc
  }, { active: 0, idle: 0 })

  const statusPills = [
    {
      key: 'active',
      label: 'Active',
      count: versionStatusSummary.active,
      color: {
        bg: 'var(--color-accent-blue-bg)',
        light: 'var(--color-accent-blue-light)',
        border: 'var(--color-accent-blue-border)'
      },
      icon: (
        <span className="flex items-center" aria-hidden="true">
          <ProgressIndicator size="sm" />
        </span>
      )
    },
    {
      key: 'idle',
      label: 'Idle',
      count: versionStatusSummary.idle,
      color: {
        bg: 'var(--color-accent-amber-bg)',
        light: 'var(--color-accent-amber-light)',
        border: 'var(--color-accent-amber-border)'
      },
      icon: (
        <span
          aria-hidden="true"
          className="text-xs font-semibold"
          style={{ color: 'var(--color-accent-amber-light)' }}
        >
          ⏸
        </span>
      )
    }
  ].filter(pill => pill.count > 0)
  

  return (
    <div className="mb-3 relative">
      {/* Version group container with subtle background */}
      <div className={clsx(
        'rounded-lg border transition-all duration-200'
      )}
      style={hasSelectedVersion ? {
        borderColor: 'var(--color-accent-blue-border)',
        backgroundColor: 'var(--color-accent-blue-bg)'
      } : {
        borderColor: 'rgba(var(--color-border-subtle-rgb), 0.5)',
        backgroundColor: 'rgba(var(--color-bg-tertiary-rgb), 0.2)'
      }}>
        {/* Group header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={clsx(
            'w-full text-left px-3 py-2 rounded-t-md border-b transition-all duration-200'
          )}
          style={hasSelectedVersion ? {
            borderBottomColor: 'var(--color-accent-blue-border)',
            backgroundColor: 'var(--color-accent-blue-bg)'
          } : {
            borderBottomColor: 'rgba(var(--color-border-subtle-rgb), 0.3)',
            backgroundColor: 'rgba(var(--color-bg-elevated-rgb), 0.3)'
          }}
          onMouseEnter={(e) => {
            if (!hasSelectedVersion) {
              e.currentTarget.style.backgroundColor = 'rgba(var(--color-bg-hover-rgb), 0.4)';
            }
          }}
          onMouseLeave={(e) => {
            if (!hasSelectedVersion) {
              e.currentTarget.style.backgroundColor = 'rgba(var(--color-bg-elevated-rgb), 0.3)';
            }
          }}
          title={`${group.baseName} (${group.versions.length} versions) - Click to expand/collapse`}
        >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Expand/collapse icon */}
            <svg 
              className={clsx('w-3 h-3 transition-transform', isExpanded ? 'rotate-90' : 'rotate-0')} 
              fill="currentColor" 
              viewBox="0 0 20 20"
            >
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span className="font-medium text-[var(--color-text-primary)]">{group.baseName}</span>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium ml-2"
              style={hasSelectedVersion ? {
                backgroundColor: 'var(--color-accent-blue-bg)',
                color: 'var(--color-accent-blue-light)',
                borderColor: 'var(--color-accent-blue-border)'
              } : {
                backgroundColor: 'rgba(var(--color-bg-hover-rgb), 0.5)',
                color: 'var(--color-text-secondary)',
                borderColor: 'rgba(var(--color-border-subtle-rgb), 0.5)'
              }}
            >
              {group.versions.length}x
            </span>
            
            {/* Base branch indicator */}
            {(() => {
              const firstSession = group.versions[0]?.session?.info
              if (!firstSession) return null

              const baseBranch = firstSession.base_branch
              if (!baseBranch || baseBranch === 'main') return null

              return (
                <>
                  <span className="text-[var(--color-text-muted)] text-xs">|</span>
                  <span className="text-xs text-[var(--color-text-muted)]">← {baseBranch}</span>
                </>
              )
            })()}
          </div>
          
          <div
            className="flex items-center gap-1 justify-end overflow-hidden flex-nowrap"
            data-testid="version-group-status"
          >
            {statusPills.map(pill => (
              <span
                key={pill.key}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold tracking-tight whitespace-nowrap flex-shrink-0"
                aria-label={`${pill.count} ${pill.label} ${pill.count === 1 ? 'session' : 'sessions'}`}
                style={{
                  backgroundColor: pill.color.bg,
                  color: pill.color.light,
                  borderColor: pill.color.border
                }}
              >
                {pill.icon}
                <span aria-hidden="true">({pill.count})</span>
                <span className="sr-only">{pill.label}</span>
              </span>
            ))}
          </div>
        </div>
        </button>

        {/* Version list (expanded) with connecting lines */}
        {isExpanded && (
          <div className="p-2 pt-0">
            <div className="relative pl-6">
              {/* Vertical connector line */}
              <div className="absolute left-2 top-2 bottom-2 w-px bg-[rgba(var(--color-border-strong-rgb),0.5)]" />
              
              <div className="space-y-1">
                 {group.versions.map((version, versionIndex) => {
                   // Check if this version is selected either as a normal session or as a spec in spec mode
                    const isSelected = (selection.kind === 'session' && selection.payload === version.session.info.session_id) ||
                                     (isInSpecMode === true && isSpec(version.session.info) && currentSpecId === version.session.info.session_id)
                    const versionAgentType = version.session.info.original_agent_type
                    const displayName = versionAgentType ? `(v${version.versionNumber} • ${versionAgentType})` : `(v${version.versionNumber})`
                    const willBeDeleted = isPreviewingDeletion && hasSelectedVersion && !isSelected

                  return (
                    <div key={version.session.info.session_id} className="relative">
                      {/* Horizontal connector from vertical line to session - aligned to button center */}
                      <div className="absolute -left-4 top-7 w-4 h-px bg-[rgba(var(--color-border-strong-rgb),0.5)]" />
                      {/* Dot on the vertical line */}
                      <div className={clsx(
                        "absolute top-7 w-2 h-2 rounded-full border",
                        isSelected
                          ? "bg-[var(--color-accent-cyan)] border-[var(--color-accent-cyan-border)]"
                          : "bg-[var(--color-bg-hover)] border-[var(--color-border-strong)]"
                      )} style={{ left: '-14px', transform: 'translate(-50%, -50%)' }} />
                      
                  <SessionCard
              session={{
                ...version.session,
                info: {
                  ...version.session.info,
                  display_name: displayName
                }
              }}
              index={startIndex + versionIndex}
              isSelected={isSelected}

                      hasFollowUpMessage={hasFollowUpMessage(version.session.info.session_id)}
                      isWithinVersionGroup={true}
                      showPromoteIcon={isSelected}
                      willBeDeleted={willBeDeleted}
                      isPromotionPreview={isPreviewingDeletion && isSelected}
                      onSelect={onSelect}
                      onMarkReady={onMarkReady}
                      onUnmarkReady={onUnmarkReady}
                      onCancel={onCancel}
                      onConvertToSpec={onConvertToSpec}
                      onRunDraft={onRunDraft}
                      onRefineSpec={onRefineSpec}
                      onDeleteSpec={onDeleteSpec}
                      onPromoteVersion={() => {
                        if (onSelectBestVersion) {
                          onSelectBestVersion(group.baseName, version.session.info.session_id)
                        }
                      }}
                      onPromoteVersionHover={() => setIsPreviewingDeletion(true)}
                      onPromoteVersionHoverEnd={() => setIsPreviewingDeletion(false)}
                      onReset={onReset}
                      onSwitchModel={onSwitchModel}
                      onCreatePullRequest={onCreatePullRequest}
                      isResetting={resettingSelection?.kind === 'session'
                        && resettingSelection.payload === version.session.info.session_id}
                      isRunning={isSessionRunning?.(version.session.info.session_id) || false}
                      onMerge={onMerge}
                      onQuickMerge={onQuickMerge}
                      disableMerge={isMergeDisabled?.(version.session.info.session_id) || false}
                      mergeStatus={getMergeStatus?.(version.session.info.session_id) ?? 'idle'}
                      isMarkReadyDisabled={isMarkReadyDisabled}
                      isBusy={isSessionBusy?.(version.session.info.session_id) ?? false}
                      onRename={onRename}
                      onLinkPr={onLinkPr}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
