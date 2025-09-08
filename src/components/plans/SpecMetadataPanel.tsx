import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { VscCalendar, VscWatch, VscNotebook } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import { AnimatedText } from '../common/AnimatedText'
import { SessionActions } from '../session/SessionActions'
import { logger } from '../../utils/logger'

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

  useEffect(() => {
    const loadMetadata = async () => {
      setLoading(true)
      try {
        const session = await invoke<any>('schaltwerk_core_get_session', { name: sessionName })
        setMetadata({
          created_at: session.created_at,
          updated_at: session.updated_at || session.last_modified,
          agent_content: session.current_task
        })
      } catch (error) {
        logger.error('[SpecMetadataPanel] Failed to load spec metadata:', error)
        setMetadata({})
      } finally {
        setLoading(false)
      }
    }

    loadMetadata()
  }, [sessionName])

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Unknown'
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return 'Unknown'
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <AnimatedText text="loading" colorClassName="text-slate-500" size="md" />
      </div>
    )
  }

  const handleRunSpec = () => {
    window.dispatchEvent(new CustomEvent('schaltwerk:start-agent-from-spec', { detail: { name: sessionName } }))
  }

  const handleDeleteSpec = async () => {
    try {
      await invoke('schaltwerk_core_cancel_session', { name: sessionName })
    } catch (error) {
      logger.error('[SpecMetadataPanel] Failed to delete spec:', error)
    }
  }

  return (
    <div className="h-full flex flex-col p-6" style={{ backgroundColor: theme.colors.background.primary }}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <div 
            className="h-10 w-10 rounded-lg flex items-center justify-center"
            style={{ 
              backgroundColor: theme.colors.background.elevated,
              border: `1px solid ${theme.colors.border.subtle}`
            }}
          >
            <VscNotebook style={{ color: theme.colors.text.secondary, fontSize: '18px' }} />
          </div>
          <div>
            <h3 style={{ 
              color: theme.colors.text.primary, 
              fontSize: theme.fontSize.heading,
              fontWeight: 600,
              marginBottom: '2px'
            }}>
              Spec Information
            </h3>
            <p style={{ color: theme.colors.text.muted, fontSize: theme.fontSize.caption }}>
              View spec metadata
            </p>
          </div>
        </div>
        <SessionActions
          sessionState="spec"
          sessionId={sessionName}
          onRunSpec={handleRunSpec}
          onDeleteSpec={handleDeleteSpec}
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <VscCalendar 
            className="mt-0.5 flex-shrink-0" 
            style={{ color: theme.colors.accent.blue.DEFAULT, fontSize: '16px' }} 
          />
          <div>
            <div style={{ 
              color: theme.colors.text.secondary, 
              fontSize: theme.fontSize.caption,
              marginBottom: '4px'
            }}>
              Created
            </div>
            <div style={{ 
              color: theme.colors.text.primary, 
              fontSize: theme.fontSize.body 
            }}>
              {formatDate(metadata.created_at)}
            </div>
          </div>
        </div>

        {metadata.updated_at && metadata.updated_at !== metadata.created_at && (
          <div className="flex items-start gap-3">
            <VscWatch 
              className="mt-0.5 flex-shrink-0" 
              style={{ color: theme.colors.accent.amber.DEFAULT, fontSize: '16px' }} 
            />
            <div>
              <div style={{ 
                color: theme.colors.text.secondary, 
                fontSize: theme.fontSize.caption,
                marginBottom: '4px'
              }}>
                Last Modified
              </div>
              <div style={{ 
                color: theme.colors.text.primary, 
                fontSize: theme.fontSize.body 
              }}>
                {formatDate(metadata.updated_at)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}