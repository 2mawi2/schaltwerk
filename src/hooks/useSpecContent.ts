import { useMemo } from 'react'
import { useSessions } from '../contexts/SessionsContext'

export interface SpecContentSnapshot {
  content: string
  displayName: string | null
  hasData: boolean
}

export function useSpecContent(sessionName: string): SpecContentSnapshot {
  const { allSessions } = useSessions()

  return useMemo(() => {
    if (!sessionName) {
      return {
        content: '',
        displayName: null,
        hasData: false,
      }
    }

    const session = allSessions.find(({ info }) => {
      return info.session_id === sessionName || info.branch === sessionName
    })

    if (!session) {
      return {
        content: '',
        displayName: null,
        hasData: false,
      }
    }

    const content = session.info.spec_content ?? session.info.current_task ?? ''
    const displayName = session.info.display_name ?? null

    return {
      content,
      displayName,
      hasData: true,
    }
  }, [allSessions, sessionName])
}
