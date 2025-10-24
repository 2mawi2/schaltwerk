import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { AttentionNotificationMode } from './useSettings'
import { EnrichedSession } from '../types/session'
import { getSessionDisplayName } from '../utils/sessionDisplayName'
import { useWindowVisibility } from './useWindowVisibility'
import { TauriCommands } from '../common/tauriCommands'
import { listenUiEvent, UiEvent } from '../common/uiEvents'
import {
  AttentionSnapshotResponse,
  getCurrentWindowLabel,
  reportAttentionSnapshot,
  requestDockBounce,
  showSystemNotification,
} from '../utils/attentionBridge'
import { logger } from '../utils/logger'

interface AttentionPreferences {
  mode: AttentionNotificationMode
  rememberBaseline: boolean
}

const DEFAULT_PREFERENCES: AttentionPreferences = {
  mode: 'dock',
  rememberBaseline: true,
}

interface UseAttentionNotificationsOptions {
  sessions: EnrichedSession[]
  projectPath: string | null
  projectDisplayName: string | null
  onProjectAttentionChange?: (count: number) => void
  onSnapshotReported?: (response: AttentionSnapshotResponse) => void
}

interface AttentionNotificationResult {
  projectAttentionCount: number
  attentionSessionIds: string[]
}

interface AttentionSession {
  sessionId: string
  sessionKey: string
  displayName: string
}

const SESSION_KEY_DELIMITER = '::'

const formatSessionKey = (projectPath: string | null, sessionId: string): string => {
  const namespace = projectPath && projectPath.trim().length > 0 ? projectPath : 'no-project'
  return `${namespace}${SESSION_KEY_DELIMITER}${sessionId}`
}

const loadPreferencesFromBackend = async (): Promise<AttentionPreferences> => {
  try {
    const preferences = await invoke<Partial<{
      attention_notification_mode: AttentionNotificationMode
      remember_idle_baseline: boolean
    }>>(TauriCommands.GetSessionPreferences)

    return {
      mode: preferences?.attention_notification_mode ?? DEFAULT_PREFERENCES.mode,
      rememberBaseline: preferences?.remember_idle_baseline ?? DEFAULT_PREFERENCES.rememberBaseline,
    }
  } catch (error) {
    logger.debug('[useAttentionNotifications] Failed to load session preferences:', error)
    return DEFAULT_PREFERENCES
  }
}

export function useAttentionNotifications({
  sessions,
  projectPath,
  projectDisplayName,
  onProjectAttentionChange,
  onSnapshotReported,
}: UseAttentionNotificationsOptions): AttentionNotificationResult {
  const visibility = useWindowVisibility()
  const [preferences, setPreferences] = useState<AttentionPreferences>(DEFAULT_PREFERENCES)
  const preferencesRef = useRef<AttentionPreferences>(DEFAULT_PREFERENCES)
  const [projectAttentionCount, setProjectAttentionCount] = useState(0)
  const [attentionSessionIds, setAttentionSessionIds] = useState<string[]>([])
  const windowLabelRef = useRef<string | null>(null)
  const attentionKeysRef = useRef<Set<string>>(new Set())
  const currentAttentionIdsRef = useRef<Set<string>>(new Set())
  const previousAttentionIdsRef = useRef<Set<string>>(new Set())
  const baselineRef = useRef<Set<string>>(new Set())
  const notifiedRef = useRef<Set<string>>(new Set())
  const lastReportedSignatureRef = useRef<string | null>(null)
  const activeProjectKeyRef = useRef<string | null>(null)
  const fetchingLabelRef = useRef(false)

  const ensureWindowLabel = useCallback(async () => {
    if (windowLabelRef.current || fetchingLabelRef.current) {
      return windowLabelRef.current
    }
    fetchingLabelRef.current = true
    const label = await getCurrentWindowLabel()
    windowLabelRef.current = label
    fetchingLabelRef.current = false
    return label
  }, [])

  useEffect(() => {
    let cancelled = false

    loadPreferencesFromBackend()
      .then((loaded) => {
        if (cancelled) return
        preferencesRef.current = loaded
        setPreferences(loaded)
      })
      .catch((error) => {
        logger.debug('[useAttentionNotifications] Failed to initialize preferences:', error)
      })

    const unlisten = listenUiEvent(UiEvent.SessionPreferencesUpdated, (detail) => {
      const next: AttentionPreferences = {
        mode: detail?.attentionNotificationMode ?? preferencesRef.current.mode,
        rememberBaseline: detail?.rememberIdleBaseline ?? preferencesRef.current.rememberBaseline,
      }
      preferencesRef.current = next
      setPreferences(next)
    })

    return () => {
      cancelled = true
      unlisten()
    }
  }, [])

  useEffect(() => {
    if (!projectPath) {
      activeProjectKeyRef.current = null
      attentionKeysRef.current.clear()
      currentAttentionIdsRef.current = new Set()
      previousAttentionIdsRef.current = new Set()
      baselineRef.current = new Set()
      notifiedRef.current = new Set()
      setProjectAttentionCount(0)
      setAttentionSessionIds([])
      onProjectAttentionChange?.(0)
      lastReportedSignatureRef.current = null
      void (async () => {
        const label = await ensureWindowLabel()
        if (!label) return
        await reportAttentionSnapshot(label, [])
        onSnapshotReported?.({ totalCount: 0, badgeLabel: null })
      })()
      return
    }

    if (activeProjectKeyRef.current !== projectPath) {
      activeProjectKeyRef.current = projectPath
      previousAttentionIdsRef.current = new Set()
      currentAttentionIdsRef.current = new Set()
      attentionKeysRef.current = new Set()
      baselineRef.current = new Set()
      notifiedRef.current = new Set()
      setProjectAttentionCount(0)
      setAttentionSessionIds([])
      onProjectAttentionChange?.(0)
      lastReportedSignatureRef.current = null
    }
  }, [projectPath, onProjectAttentionChange, ensureWindowLabel, onSnapshotReported])

  const pushSnapshot = useCallback(
    async (sessionKeys: string[]) => {
      const label = await ensureWindowLabel()
      if (!label) {
        return
      }
      const sortedKeys = [...sessionKeys].sort()
      const signature = `${visibility.isForeground ? 'fg' : 'bg'}|${sortedKeys.join('|')}`
      if (lastReportedSignatureRef.current === signature) {
        return
      }
      lastReportedSignatureRef.current = signature
      const response = await reportAttentionSnapshot(label, sortedKeys)
      onSnapshotReported?.(response)
    },
    [ensureWindowLabel, visibility.isForeground, onSnapshotReported]
  )

  useEffect(() => {
    if (visibility.isForeground) {
      baselineRef.current.clear()
      notifiedRef.current.clear()
      void pushSnapshot([])
    } else {
      if (preferencesRef.current.rememberBaseline) {
        baselineRef.current = new Set(currentAttentionIdsRef.current)
      } else {
        baselineRef.current.clear()
      }
      void pushSnapshot(Array.from(attentionKeysRef.current))
    }
  }, [visibility.isForeground, pushSnapshot])

  useEffect(() => {
    const attentionSessions: AttentionSession[] = (projectPath
      ? sessions.filter(session => session.info.attention_required)
      : []
    ).map(session => {
      const sessionId = session.info.session_id
      return {
        sessionId,
        sessionKey: formatSessionKey(projectPath, sessionId),
        displayName: getSessionDisplayName(session.info),
      }
    })

    const nextIdSet = new Set(attentionSessions.map(item => item.sessionId))
    const nextKeySet = new Set(attentionSessions.map(item => item.sessionKey))

    for (const previousId of previousAttentionIdsRef.current) {
      if (!nextIdSet.has(previousId)) {
        baselineRef.current.delete(previousId)
        notifiedRef.current.delete(previousId)
      }
    }

    const newIdleSessions = attentionSessions.filter(item => !previousAttentionIdsRef.current.has(item.sessionId))

    if (!visibility.isForeground && preferencesRef.current.mode !== 'off' && newIdleSessions.length > 0) {
      let shouldBounce = false
      const shouldShowDock = preferencesRef.current.mode === 'dock' || preferencesRef.current.mode === 'both'
      const shouldShowSystem = preferencesRef.current.mode === 'system' || preferencesRef.current.mode === 'both'
      const projectLabel = projectDisplayName && projectDisplayName.trim().length > 0
        ? projectDisplayName
        : 'Schaltwerk'

      for (const session of newIdleSessions) {
        if (preferencesRef.current.rememberBaseline && baselineRef.current.has(session.sessionId)) {
          continue
        }
        if (notifiedRef.current.has(session.sessionId)) {
          continue
        }
        if (shouldShowDock) {
          shouldBounce = true
        }
        if (shouldShowSystem) {
          const body = `${session.displayName} is ready for input.`
          void showSystemNotification({
            title: `${projectLabel} · Agent idle`,
            body,
            silent: true,
          })
        }
        notifiedRef.current.add(session.sessionId)
      }

      if (shouldBounce) {
        void requestDockBounce()
      }
    }

    previousAttentionIdsRef.current = nextIdSet
    currentAttentionIdsRef.current = nextIdSet
    attentionKeysRef.current = nextKeySet

    const nextIdsArray = Array.from(nextIdSet)
    setProjectAttentionCount(nextIdSet.size)
    setAttentionSessionIds(nextIdsArray)
    onProjectAttentionChange?.(nextIdSet.size)

    const keysForSnapshot = visibility.isForeground ? [] : Array.from(nextKeySet)
    void pushSnapshot(keysForSnapshot)
  }, [
    sessions,
    projectPath,
    projectDisplayName,
    visibility.isForeground,
    pushSnapshot,
    onProjectAttentionChange,
  ])

  useEffect(() => {
    if (!preferences.rememberBaseline) {
      baselineRef.current.clear()
    }
  }, [preferences.rememberBaseline])

  return useMemo(
    () => ({
      projectAttentionCount,
      attentionSessionIds,
    }),
    [projectAttentionCount, attentionSessionIds]
  )
}
