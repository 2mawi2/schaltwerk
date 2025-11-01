import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'
import type { Selection } from '../../hooks/useSelection'
import { FEEDBACK_ISSUE_URL } from './constants'
import { composeFeedbackBody } from './template'
import { useOptionalToast } from '../../common/toast/ToastProvider'

interface UseFeedbackOptions {
  selection: Selection
}

export function useFeedback({ selection }: UseFeedbackOptions) {
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const toast = useOptionalToast()

  useEffect(() => {
    let cancelled = false

    invoke<string>(TauriCommands.GetAppVersion)
      .then(version => {
        if (!cancelled) {
          setAppVersion(version)
        }
      })
      .catch(error => {
        logger.debug('[Feedback] Failed to retrieve app version', error)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const openFeedback = useCallback(() => {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
    const contextLines = [
      `- App version: ${appVersion ?? 'unknown'}`,
      `- Platform: ${userAgent}`,
    ]

    if (selection.kind === 'session' && selection.payload) {
      contextLines.push(`- Session: ${selection.payload}`)
      if (selection.sessionState) {
        contextLines.push(`- Session state: ${selection.sessionState}`)
      }
    }
    const templateQuery = 'template=feature_request.md'
    const titleQuery = 'title=' + encodeURIComponent('Feedback')
    const bodyQuery = 'body=' + encodeURIComponent(composeFeedbackBody(contextLines))
    const url = `${FEEDBACK_ISSUE_URL}?${templateQuery}&${titleQuery}&${bodyQuery}`

    invoke<void>(TauriCommands.OpenExternalUrl, { url }).catch(error => {
      logger.warn('[Feedback] Failed to open external feedback link', error)
      toast?.pushToast({
        tone: 'error',
        title: 'Failed to open feedback link',
        description: 'Copy the link from the logs and open it manually.',
      })
    })
  }, [appVersion, selection, toast])

  return { openFeedback }
}
