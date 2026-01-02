import { useState, useEffect, useCallback } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { VscCalendar, VscWatch, VscNotebook } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import { AnimatedText } from '../common/AnimatedText'
import { SessionActions } from '../session/SessionActions'
import { logger } from '../../utils/logger'
import { formatDateTime } from '../../utils/dateTime'
import { useSessions } from '../../hooks/useSessions'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'
import { getSessionDisplayName } from '../../utils/sessionDisplayName'
import { isSessionMissingError } from '../../types/errors'

const METADATA_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
}

interface SpecMetadata {
  created_at?: string
  updated_at?: string
  agent_content?: string
}

interface Props {
  sessionName: string
}

export function SpecMetadataPanel({ sessionName }: Props) {
  const [metadata, setMetadata] = useState<SpecMetadata>({})
  const [loading, setLoading] = useState(true)
  const { sessions } = useSessions()

  useEffect(() => {
    const loadMetadata = async () => {
      setLoading(true)
      try {
        const session = await invoke<Record<string, unknown>>(TauriCommands.SchaltwerkCoreGetSession, { name: sessionName })
        setMetadata({
          created_at: session.created_at as string | undefined,
          updated_at: (session.updated_at as string | undefined) || (session.last_modified as string | undefined),
          agent_content: session.current_task as string | undefined
        })
      } catch (error) {
        if (isSessionMissingError(error)) {
          setMetadata({})
        } else {
          logger.error('[SpecMetadataPanel] Failed to load spec metadata:', error)
          setMetadata({})
        }
      } finally {
        setLoading(false)
      }
    }

    void loadMetadata()
  }, [sessionName])

  const handleRunSpec = useCallback((id: string) => {
    window.dispatchEvent(new CustomEvent('schaltwerk:start-agent-from-spec', { detail: { name: id } }))
  }, [])

  const handleDeleteSpec = useCallback((id: string) => {
    const session = sessions.find(s => s.info.session_id === id)
    const sessionDisplayName = session ? getSessionDisplayName(session.info) : id

    emitUiEvent(UiEvent.SessionAction, {
      action: 'delete-spec',
      sessionId: id,
      sessionName: id,
      sessionDisplayName,
      branch: session?.info.branch,
      hasUncommittedChanges: false,
    })
  }, [sessions])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <AnimatedText text="loading" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-6" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div 
            className="h-10 w-10 rounded-lg flex items-center justify-center"
            style={{ 
              backgroundColor: 'var(--color-bg-elevated)',
              border: `1px solid ${'var(--color-border-subtle)'}`
            }}
          >
            <VscNotebook style={{ color: 'var(--color-text-secondary)', fontSize: theme.fontSize.heading }} />
          </div>
          <div>
            <h3 style={{ 
              color: 'var(--color-text-primary)', 
              fontSize: theme.fontSize.heading,
              fontWeight: 600,
              marginBottom: '2px'
            }}>
              Spec Information
            </h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: theme.fontSize.caption }}>
              View spec metadata
            </p>
          </div>
        </div>
        <SessionActions
          sessionState="spec"
          sessionId={sessionName}
          onRunSpec={(id) => handleRunSpec(id)}
          onDeleteSpec={(id) => { void handleDeleteSpec(id) }}
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <VscCalendar 
            className="mt-0.5 flex-shrink-0" 
            style={{ color: 'var(--color-accent-blue)', fontSize: theme.fontSize.heading }} 
          />
          <div>
            <div style={{ 
              color: 'var(--color-text-secondary)', 
              fontSize: theme.fontSize.caption,
              marginBottom: '4px'
            }}>
              Created
            </div>
            <div style={{ 
              color: 'var(--color-text-primary)', 
              fontSize: theme.fontSize.body 
            }}>
              {formatDateTime(metadata.created_at, METADATA_DATE_OPTIONS, 'Unknown', 'en-US')}
            </div>
          </div>
        </div>

        {metadata.updated_at && metadata.updated_at !== metadata.created_at && (
          <div className="flex items-start gap-3">
            <VscWatch 
              className="mt-0.5 flex-shrink-0" 
              style={{ color: 'var(--color-accent-amber)', fontSize: theme.fontSize.heading }} 
            />
            <div>
              <div style={{ 
                color: 'var(--color-text-secondary)', 
                fontSize: theme.fontSize.caption,
                marginBottom: '4px'
              }}>
                Last Modified
              </div>
              <div style={{ 
                color: 'var(--color-text-primary)', 
                fontSize: theme.fontSize.body 
              }}>
                {formatDateTime(metadata.updated_at, METADATA_DATE_OPTIONS, 'Unknown', 'en-US')}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
