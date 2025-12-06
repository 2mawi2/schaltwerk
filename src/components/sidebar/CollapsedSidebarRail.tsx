import { memo } from 'react'
import { EnrichedSession } from '../../types/session'
import { Selection } from '../../store/atoms/selection'
import { SessionRailCard } from './SessionRailCard'

interface CollapsedSidebarRailProps {
  sessions: EnrichedSession[]
  selection: Selection
  hasFollowUpMessage: (sessionId: string) => boolean
  isSessionRunning?: (sessionId: string) => boolean
  onSelect: (sessionOrIndex: string | number) => void
  onExpandRequest?: () => void
}

export const CollapsedSidebarRail = memo<CollapsedSidebarRailProps>(function CollapsedSidebarRail({
  sessions,
  selection,
  hasFollowUpMessage,
  isSessionRunning,
  onSelect,
  onExpandRequest,
}) {
  if (sessions.length === 0) {
    return null
  }

  return (
    <div
      className="flex flex-col"
      data-testid="collapsed-rail"
      onClick={(event) => {
        if (event.target === event.currentTarget && onExpandRequest) {
          onExpandRequest()
        }
      }}
      role="presentation"
    >
      {sessions.map((session, index) => (
        <SessionRailCard
          key={session.info.session_id}
          session={session}
          index={index}
          isSelected={selection.kind === 'session' && selection.payload === session.info.session_id}
          hasFollowUpMessage={hasFollowUpMessage(session.info.session_id)}
          isRunning={isSessionRunning?.(session.info.session_id) ?? false}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
})
