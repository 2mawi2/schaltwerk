import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { logger } from '../utils/logger'

export interface ProjectFileIndexApi {
  files: string[]
  isLoading: boolean
  error: string | null
  ensureIndex: (options?: { force?: boolean }) => Promise<string[]>
  refreshIndex: () => Promise<string[]>
  getSnapshot: () => string[]
}

export function useProjectFileIndex(): ProjectFileIndexApi {
  const [files, setFiles] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const filesRef = useRef<string[]>([])
  const inFlightRef = useRef<Promise<string[]> | null>(null)

  const runFetch = useCallback(
    async (forceRefresh: boolean): Promise<string[]> => {
      if (!forceRefresh) {
        if (filesRef.current.length > 0) {
          return filesRef.current
        }
        if (inFlightRef.current) {
          return inFlightRef.current
        }
      }

      const request = invoke<string[] | null>(TauriCommands.SchaltwerkCoreListProjectFiles, {
        force_refresh: forceRefresh,
      })
        .then(result => {
          const normalized = Array.isArray(result) ? result : []
          if (!Array.isArray(result)) {
            logger.warn('[useProjectFileIndex] Received non-array payload for project files index')
          }
          filesRef.current = normalized
          setFiles(normalized)
          setError(null)
          return normalized
        })
        .catch(err => {
          const message = err instanceof Error ? err.message : String(err)
          logger.error('[useProjectFileIndex] Failed to load file index:', message)
          setError(message)
          return []
        })
        .finally(() => {
          if (inFlightRef.current === request) {
            inFlightRef.current = null
          }
          setIsLoading(false)
        })

      inFlightRef.current = request
      setIsLoading(true)
      return request
    },
    []
  )

  const ensureIndex = useCallback(
    async (options?: { force?: boolean }): Promise<string[]> => {
      const forceRefresh = options?.force ?? false
      if (!forceRefresh && filesRef.current.length > 0) {
        return filesRef.current
      }
      return runFetch(forceRefresh)
    },
    [runFetch]
  )

  const refreshIndex = useCallback(async (): Promise<string[]> => {
    return runFetch(true)
  }, [runFetch])

  useEffect(() => {
    const unlistenPromise = listenEvent(SchaltEvent.ProjectFilesUpdated, payload => {
      if (Array.isArray(payload)) {
        filesRef.current = payload
        setFiles(payload)
        setError(null)
        setIsLoading(false)
      }
    })

    return () => {
      unlistenPromise
        .then(unlisten => {
          unlisten()
        })
        .catch(err => {
          logger.warn('[useProjectFileIndex] Failed to unlisten ProjectFilesUpdated event', err)
        })
    }
  }, [])

  const getSnapshot = useCallback(() => filesRef.current, [])

  return useMemo(
    () => ({
      files,
      isLoading,
      error,
      ensureIndex,
      refreshIndex,
      getSnapshot,
    }),
    [files, isLoading, error, ensureIndex, refreshIndex, getSnapshot]
  )
}
