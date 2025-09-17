import { useCallback, useEffect, useRef, useState } from 'react'
import type { EnrichedSession, SessionInfo } from '../types/session'

interface UseIdleSessionsOptions {
  sessions: EnrichedSession[]
  includeSpecs: boolean
  includeReviewed: boolean
  idleThresholdMs: number
  nowProvider?: () => number
}

interface UseIdleSessionsResult {
  idleIds: Set<string>
  recomputeIdle: () => void
}

const IDLE_RECHECK_INTERVAL_MS = 30_000

type SessionUiState = 'spec' | 'running' | 'reviewed'

function mapSessionUiState(info: SessionInfo): SessionUiState {
  if (info.session_state === 'spec' || info.status === 'spec') return 'spec'
  if (info.ready_to_merge) return 'reviewed'
  return 'running'
}

function isSpec(info: SessionInfo): boolean {
  return mapSessionUiState(info) === 'spec'
}

function isReviewed(info: SessionInfo): boolean {
  return mapSessionUiState(info) === 'reviewed'
}

export function useIdleSessions({
  sessions,
  includeSpecs,
  includeReviewed,
  idleThresholdMs,
  nowProvider
}: UseIdleSessionsOptions): UseIdleSessionsResult {
  const [idleIds, setIdleIds] = useState<Set<string>>(() => new Set())
  const nowRef = useRef<() => number>(() => Date.now())

  useEffect(() => {
    nowRef.current = nowProvider ?? Date.now
  }, [nowProvider])

  const recomputeIdle = useCallback(() => {
    const now = nowRef.current()
    const next = new Set<string>()

    for (const session of sessions) {
      const info = session.info
      const lastModified = info.last_modified_ts
      if (typeof lastModified !== 'number') continue

      if (!includeSpecs && isSpec(info)) continue
      if (!includeReviewed && isReviewed(info)) continue

      if (now - lastModified >= idleThresholdMs) {
        next.add(info.session_id)
      }
    }

    setIdleIds((prev) => {
      if (prev.size === next.size) {
        let unchanged = true
        for (const id of prev) {
          if (!next.has(id)) {
            unchanged = false
            break
          }
        }
        if (unchanged) return prev
      }
      return next
    })
  }, [sessions, includeSpecs, includeReviewed, idleThresholdMs])

  useEffect(() => {
    recomputeIdle()
    const intervalId = setInterval(recomputeIdle, IDLE_RECHECK_INTERVAL_MS)
    return () => {
      clearInterval(intervalId)
    }
  }, [recomputeIdle])

  return { idleIds, recomputeIdle }
}
