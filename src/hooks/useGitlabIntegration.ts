import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { TauriCommands } from '../common/tauriCommands'
import type { GitlabSource } from '../types/gitlabTypes'
import type { GitLabStatusPayload } from '../common/events'
import { logger } from '../utils/logger'
import { resolveErrorMessage } from '../utils/resolveErrorMessage'

export interface GitlabIntegrationValue {
  status: GitLabStatusPayload | null
  sources: GitlabSource[]
  loading: boolean
  isGlabMissing: boolean
  hasSources: boolean
  refreshStatus: () => Promise<void>
  loadSources: () => Promise<void>
  saveSources: (sources: GitlabSource[]) => Promise<void>
}

export function useGitlabIntegration(): GitlabIntegrationValue {
  const [status, setStatus] = useState<GitLabStatusPayload | null>(null)
  const [sources, setSources] = useState<GitlabSource[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const unlistenRef = useRef<(() => void) | null>(null)

  const refreshStatus = useCallback(async () => {
    setLoading(true)
    try {
      const result = await invoke<GitLabStatusPayload>(TauriCommands.GitLabGetStatus)
      setStatus(result)
    } catch (error) {
      logger.error('[useGitlabIntegration] Failed to fetch GitLab status', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSources = useCallback(async () => {
    try {
      const result = await invoke<GitlabSource[]>(TauriCommands.GitLabGetSources)
      setSources(result ?? [])
    } catch (error) {
      logger.error('[useGitlabIntegration] Failed to load GitLab sources', error)
    }
  }, [])

  const saveSources = useCallback(async (newSources: GitlabSource[]) => {
    try {
      await invoke(TauriCommands.GitLabSetSources, { sources: newSources })
      setSources(newSources)
    } catch (error) {
      const message = resolveErrorMessage(error)
      logger.error('[useGitlabIntegration] Failed to save GitLab sources', message)
    }
  }, [])

  useEffect(() => {
    let mounted = true

    refreshStatus().catch((error) => {
      logger.error('[useGitlabIntegration] Initial status fetch failed', error)
    })

    loadSources().catch((error) => {
      logger.error('[useGitlabIntegration] Initial sources fetch failed', error)
    })

    listenEvent(SchaltEvent.GitLabStatusChanged, (payload) => {
      if (mounted) {
        setStatus(payload)
        setLoading(false)
      }
    })
      .then((unlisten) => {
        if (!mounted) {
          try {
            unlisten()
          } catch (error) {
            logger.warn('[useGitlabIntegration] Failed to cleanup GitLab listener after unmount', error)
          }
        } else {
          unlistenRef.current = unlisten
        }
      })
      .catch((error) => {
        logger.error('[useGitlabIntegration] Failed to register GitLab status listener', error)
      })

    return () => {
      mounted = false
      if (unlistenRef.current) {
        try {
          unlistenRef.current()
        } catch (error) {
          logger.warn('[useGitlabIntegration] Failed to remove GitLab status listener', error)
        }
      }
    }
  }, [refreshStatus, loadSources])

  const value = useMemo<GitlabIntegrationValue>(() => {
    return {
      status,
      sources,
      loading,
      isGlabMissing: status ? !status.installed : false,
      hasSources: sources.length > 0,
      refreshStatus,
      loadSources,
      saveSources,
    }
  }, [
    status,
    sources,
    loading,
    refreshStatus,
    loadSources,
    saveSources,
  ])

  return value
}
