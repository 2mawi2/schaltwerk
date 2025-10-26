import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
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
  openProjectPaths?: string[]
  onProjectAttentionChange?: (count: number) => void
  onAttentionSummaryChange?: (summary: AttentionSummary) => void
  onSnapshotReported?: (response: AttentionSnapshotResponse) => void
}

interface AttentionNotificationResult {
  projectAttentionCount: number
  attentionSessionIds: string[]
  totalAttentionCount: number
}

interface AttentionSession {
  sessionId: string
  sessionKey: string
  displayName: string
}

const SESSION_KEY_DELIMITER = '::'

interface AttentionSummary {
  perProjectCounts: Record<string, number>
  totalCount: number
}

export const shouldCountSessionForAttention = (session: EnrichedSession): boolean => {
  const requiresAttention = session.info.attention_required === true
  const isReviewed = session.info.ready_to_merge === true
  return requiresAttention && !isReviewed
}

const formatProjectKey = (projectPath: string | null): string => {
  return projectPath && projectPath.trim().length > 0 ? projectPath : 'no-project'
}

const formatSessionKey = (projectPath: string | null, sessionId: string): string => {
  const namespace = formatProjectKey(projectPath)
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
  onProjectAttentionChange,
  onAttentionSummaryChange,
  openProjectPaths,
  onSnapshotReported,
}: UseAttentionNotificationsOptions): AttentionNotificationResult {
  const visibility = useWindowVisibility()
  const [preferences, setPreferences] = useState<AttentionPreferences>(DEFAULT_PREFERENCES)
  const preferencesRef = useRef<AttentionPreferences>(DEFAULT_PREFERENCES)
  const [projectAttentionCount, setProjectAttentionCount] = useState(0)
  const [attentionSessionIds, setAttentionSessionIds] = useState<string[]>([])
  const [totalAttentionCount, setTotalAttentionCount] = useState(0)
  const windowLabelRef = useRef<string | null>(null)
  const projectAttentionKeyMapRef = useRef<Map<string, Set<string>>>(new Map())
  const globalAttentionKeysRef = useRef<Set<string>>(new Set())
  const previousAttentionKeysRef = useRef<Set<string>>(new Set())
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

  const recomputeAttentionSummary = useEffectEvent(() => {
    const allowed = openProjectPaths ? new Set(openProjectPaths) : null
    if (allowed) {
      for (const key of Array.from(projectAttentionKeyMapRef.current.keys())) {
        if (!allowed.has(key)) {
          projectAttentionKeyMapRef.current.delete(key)
        }
      }
    }

    const perProjectCounts: Record<string, number> = {}
    const aggregatedKeys = new Set<string>()
    for (const [projectKey, keys] of projectAttentionKeyMapRef.current.entries()) {
      perProjectCounts[projectKey] = keys.size
      for (const key of keys) {
        aggregatedKeys.add(key)
      }
    }

    globalAttentionKeysRef.current = aggregatedKeys
    setTotalAttentionCount(aggregatedKeys.size)
    onAttentionSummaryChange?.({
      perProjectCounts,
      totalCount: aggregatedKeys.size,
    })

    return { aggregatedKeys }
  })

  useEffect(() => {
    recomputeAttentionSummary()
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

  const pushSnapshot = useEffectEvent(
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
    }
  )

  useEffect(() => {
    if (!projectPath) {
      const previousProject = activeProjectKeyRef.current
      if (previousProject) {
        projectAttentionKeyMapRef.current.delete(previousProject)
      }
      activeProjectKeyRef.current = null
      previousAttentionKeysRef.current = new Set()
      baselineRef.current = new Set()
      notifiedRef.current = new Set()
      setProjectAttentionCount(0)
      setAttentionSessionIds([])
      onProjectAttentionChange?.(0)
      const aggregate = recomputeAttentionSummary()
      lastReportedSignatureRef.current = null
      void pushSnapshot(visibility.isForeground ? [] : Array.from(aggregate.aggregatedKeys))
      return
    }

    const projectKey = formatProjectKey(projectPath)
    if (!projectAttentionKeyMapRef.current.has(projectKey)) {
      projectAttentionKeyMapRef.current.set(projectKey, new Set())
    }

    if (activeProjectKeyRef.current !== projectPath) {
      activeProjectKeyRef.current = projectPath
      previousAttentionKeysRef.current = new Set()
      baselineRef.current = new Set()
      notifiedRef.current = new Set()
      setProjectAttentionCount(0)
      setAttentionSessionIds([])
      onProjectAttentionChange?.(0)
      lastReportedSignatureRef.current = null
    }

    const aggregate = recomputeAttentionSummary()
    void pushSnapshot(visibility.isForeground ? [] : Array.from(aggregate.aggregatedKeys))
  }, [
    projectPath,
    onProjectAttentionChange,
    visibility.isForeground,
  ])

  useEffect(() => {
    if (visibility.isForeground) {
      baselineRef.current.clear()
      notifiedRef.current.clear()
      void pushSnapshot([])
    } else {
      if (preferencesRef.current.rememberBaseline) {
        baselineRef.current = new Set(globalAttentionKeysRef.current)
      } else {
        baselineRef.current.clear()
      }
      void pushSnapshot(Array.from(globalAttentionKeysRef.current))
    }
  }, [visibility.isForeground])

  useEffect(() => {
    const attentionSessions: AttentionSession[] = (projectPath
      ? sessions.filter(shouldCountSessionForAttention)
      : []
    ).map(session => {
      const sessionId = session.info.session_id
      return {
        sessionId,
        sessionKey: formatSessionKey(projectPath, sessionId),
        displayName: getSessionDisplayName(session.info),
      }
    })

    const nextKeySet = new Set(attentionSessions.map(item => item.sessionKey))

    for (const previousKey of previousAttentionKeysRef.current) {
      if (!nextKeySet.has(previousKey)) {
        baselineRef.current.delete(previousKey)
        notifiedRef.current.delete(previousKey)
      }
    }

    const newIdleSessions = attentionSessions.filter(item => !previousAttentionKeysRef.current.has(item.sessionKey))

    const notificationsEnabled = preferencesRef.current.mode !== 'off'

    if (!visibility.isForeground && notificationsEnabled && newIdleSessions.length > 0) {
      let shouldBounce = false

      for (const session of newIdleSessions) {
        if (preferencesRef.current.rememberBaseline && baselineRef.current.has(session.sessionKey)) {
          continue
        }
        if (notifiedRef.current.has(session.sessionKey)) {
          continue
        }
        shouldBounce = true
        notifiedRef.current.add(session.sessionKey)
      }

      if (shouldBounce) {
        void requestDockBounce()
      }
    }

    if (projectPath) {
      const projectKey = formatProjectKey(projectPath)
      projectAttentionKeyMapRef.current.set(projectKey, nextKeySet)
    }

    previousAttentionKeysRef.current = nextKeySet

    const nextKeysArray = Array.from(nextKeySet)
    setProjectAttentionCount(nextKeySet.size)
    setAttentionSessionIds(nextKeysArray)
    onProjectAttentionChange?.(nextKeySet.size)

    const aggregate = recomputeAttentionSummary()
    const keysForSnapshot = visibility.isForeground ? [] : Array.from(aggregate.aggregatedKeys)
    void pushSnapshot(keysForSnapshot)
  }, [
    sessions,
    projectPath,
    visibility.isForeground,
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
      totalAttentionCount,
    }),
    [projectAttentionCount, attentionSessionIds, totalAttentionCount]
  )
}
