import { memo, useState } from 'react'
import { clsx } from 'clsx'
import { SessionButton } from './SessionButton'
import { SessionVersionGroup as SessionVersionGroupType } from '../../utils/sessionVersions'
import { isSpec } from '../../utils/sessionFilters'
import { SessionSelection } from '../../hooks/useSessionManagement'
import { theme } from '../../common/theme'
import type { MergeStatus } from '../../contexts/SessionsContext'

interface SessionVersionGroupProps {
  group: SessionVersionGroupType
  selection: {
    kind: string
    payload?: string
  }
  startIndex: number  // The starting index of this group in the overall sessions list

  hasFollowUpMessage: (sessionId: string) => boolean
  onSelect: (index: number) => void
  onMarkReady: (sessionId: string, hasUncommitted: boolean) => void
  onUnmarkReady: (sessionId: string) => void
  onCancel: (sessionId: string, hasUncommitted: boolean) => void
  onConvertToSpec?: (sessionId: string) => void
  onRunDraft?: (sessionId: string) => void
  onDeleteSpec?: (sessionId: string) => void
  onSelectBestVersion?: (groupBaseName: string, selectedSessionId: string) => void
  onReset?: (sessionId: string) => void
  onSwitchModel?: (sessionId: string) => void
  resettingSelection?: SessionSelection | null
  isInSpecMode?: boolean  // Optional: whether we're in spec mode
  currentSpecId?: string | null  // Optional: current spec selected in spec mode
  isSessionRunning?: (sessionId: string) => boolean  // Function to check if a session is running
  onMerge?: (sessionId: string) => void
  isMergeDisabled?: (sessionId: string) => boolean
  getMergeStatus?: (sessionId: string) => MergeStatus
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
  onDeleteSpec,
  onSelectBestVersion,
  onReset,
  onSwitchModel,
  resettingSelection,
  isInSpecMode,
  currentSpecId,
  isSessionRunning,
    onMerge,
    isMergeDisabled,
    getMergeStatus
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
      <SessionButton
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
        onDeleteSpec={onDeleteSpec}
        onReset={onReset}
        onSwitchModel={onSwitchModel}
        isResetting={isResettingForSession}
        isRunning={isSessionRunning?.(session.session.info.session_id) || false}
        onMerge={onMerge}
        disableMerge={isMergeDisabled?.(session.session.info.session_id) || false}
        mergeStatus={getMergeStatus?.(session.session.info.session_id) ?? 'idle'}
      />
    )
  }

  // Check if any version in the group is selected
  const selectedVersionInGroup = group.versions.find(
    v => selection.kind === 'session' && selection.payload === v.session.info.session_id
  )
  const hasSelectedVersion = !!selectedVersionInGroup
  

  return (
    <div className="mb-3 relative">
      {/* Version group container with subtle background */}
      <div className={clsx(
        'rounded-lg border transition-all duration-200'
      )}
      style={hasSelectedVersion ? {
        borderColor: theme.colors.accent.blue.border,
        backgroundColor: theme.colors.accent.blue.bg
      } : {
        borderColor: 'rgba(71, 85, 105, 0.5)', // slate-700/50
        backgroundColor: 'rgba(15, 23, 42, 0.2)' // slate-900/20
      }}>
        {/* Group header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={clsx(
            'w-full text-left px-3 py-2 rounded-t-md border-b transition-all duration-200'
          )}
          style={hasSelectedVersion ? {
            borderBottomColor: theme.colors.accent.blue.border,
            backgroundColor: theme.colors.accent.blue.bg
          } : {
            borderBottomColor: 'rgba(71, 85, 105, 0.3)', // slate-700/30
            backgroundColor: 'rgba(30, 41, 59, 0.3)' // slate-800/30
          }}
          onMouseEnter={(e) => {
            if (!hasSelectedVersion) {
              e.currentTarget.style.backgroundColor = 'rgba(51, 65, 85, 0.4)'; // slate-700/40
            }
          }}
          onMouseLeave={(e) => {
            if (!hasSelectedVersion) {
              e.currentTarget.style.backgroundColor = 'rgba(30, 41, 59, 0.3)'; // slate-800/30
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
            <span className="font-medium text-slate-100">{group.baseName}</span>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium ml-2"
              style={hasSelectedVersion ? {
                backgroundColor: theme.colors.accent.blue.bg,
                color: theme.colors.accent.blue.light,
                borderColor: theme.colors.accent.blue.border
              } : {
                backgroundColor: 'rgba(51, 65, 85, 0.5)', // slate-700/50
                color: 'rgb(203, 213, 225)', // slate-300
                borderColor: 'rgba(71, 85, 105, 0.5)' // slate-600/50
              }}
            >
              {group.versions.length}x
            </span>
            
            {/* Agent info */}
            {(() => {
              const firstSession = group.versions[0]?.session?.info
              if (!firstSession) return null
              
              const agentType = firstSession.original_agent_type
              const baseBranch = firstSession.base_branch
              const agentColor = agentType === 'claude' ? 'blue' : 
                               agentType === 'opencode' ? 'green' : 
                               agentType === 'gemini' ? 'orange' : 
                               agentType === 'codex' ? 'red' : 'gray'
              
              return (
                <>
                  {agentType && (
                    <>
                      <span className="text-slate-400 text-xs">|</span>
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
                        title={`Agent: ${agentType}`}
                      >
                        <span className="w-1 h-1 rounded-full"
                              style={{
                                backgroundColor: agentColor === 'blue' ? theme.colors.accent.blue.DEFAULT :
                                                agentColor === 'green' ? theme.colors.accent.green.DEFAULT :
                                                agentColor === 'orange' ? theme.colors.accent.amber.DEFAULT :
                                                theme.colors.accent.red.DEFAULT
                              }} />
                        {agentType}
                      </span>
                    </>
                  )}
                  {baseBranch && baseBranch !== 'main' && (
                    <>
                      <span className="text-slate-400 text-xs">|</span>
                      <span className="text-xs text-slate-400">← {baseBranch}</span>
                    </>
                  )}
                </>
              )
            })()}
          </div>
          
          <div className="flex items-center gap-3">
            
          </div>
        </div>
        </button>

        {/* Version list (expanded) with connecting lines */}
        {isExpanded && (
          <div className="p-2 pt-0">
            <div className="relative pl-6">
              {/* Vertical connector line */}
              <div className="absolute left-2 top-2 bottom-2 w-px bg-slate-600/50" />
              
              <div className="space-y-1">
                 {group.versions.map((version, versionIndex) => {
                   // Check if this version is selected either as a normal session or as a spec in spec mode
                    const isSelected = (selection.kind === 'session' && selection.payload === version.session.info.session_id) ||
                                     (isInSpecMode === true && isSpec(version.session.info) && currentSpecId === version.session.info.session_id)
                    const displayName = `(v${version.versionNumber})`
                    const willBeDeleted = isPreviewingDeletion && hasSelectedVersion && !isSelected

                  return (
                    <div key={version.session.info.session_id} className="relative">
                      {/* Horizontal connector from vertical line to session - aligned to button center */}
                      <div className="absolute -left-4 top-7 w-4 h-px bg-slate-600/50" />
                      {/* Dot on the vertical line */}
                      <div className={clsx(
                        "absolute top-7 w-2 h-2 rounded-full border",
                        isSelected
                          ? "bg-cyan-400 border-cyan-300"
                          : "bg-slate-700 border-slate-600"
                      )} style={{ left: '-14px', transform: 'translate(-50%, -50%)' }} />
                      
                  <SessionButton
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
              isResetting={resettingSelection?.kind === 'session'
                && resettingSelection.payload === version.session.info.session_id}
              isRunning={isSessionRunning?.(version.session.info.session_id) || false}
              onMerge={onMerge}
              disableMerge={isMergeDisabled?.(version.session.info.session_id) || false}
              mergeStatus={getMergeStatus?.(version.session.info.session_id) ?? 'idle'}
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
