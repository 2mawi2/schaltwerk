import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { TauriCommands } from '../common/tauriCommands'
import { GitHubStatusPayload, GitHubPrPayload, GitHubRepositoryPayload } from '../common/events'
import { logger } from '../utils/logger'

export interface CreateReviewedPrArgs {
  sessionId: string
  sessionSlug: string
  worktreePath: string
  defaultBranch?: string
  commitMessage?: string
  repository?: string
}

export interface GithubIntegrationValue {
  status: GitHubStatusPayload | null
  loading: boolean
  isAuthenticating: boolean
  isConnecting: boolean
  isCreatingPr: (sessionId: string) => boolean
  authenticate: () => Promise<GitHubStatusPayload>
  connectProject: () => Promise<GitHubRepositoryPayload>
  createReviewedPr: (args: CreateReviewedPrArgs) => Promise<GitHubPrPayload>
  getCachedPrUrl: (sessionId: string) => string | undefined
  canCreatePr: boolean
  isGhMissing: boolean
  hasRepository: boolean
  refreshStatus: () => Promise<void>
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function useGithubIntegration(): GithubIntegrationValue {
  const [status, setStatus] = useState<GitHubStatusPayload | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [creating, setCreating] = useState<Record<string, boolean>>({})
  const [lastPrUrls, setLastPrUrls] = useState<Record<string, string>>({})
  const unlistenRef = useRef<(() => void) | null>(null)

  const refreshStatus = useCallback(async () => {
    setLoading(true)
    try {
      const result = await invoke<GitHubStatusPayload>(TauriCommands.GitHubGetStatus)
      setStatus(result)
    } catch (error) {
      logger.error('[useGithubIntegration] Failed to fetch GitHub status', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let mounted = true

    refreshStatus().catch((error) => {
      logger.error('[useGithubIntegration] Initial status fetch failed', error)
    })

    listenEvent(SchaltEvent.GitHubStatusChanged, (payload: GitHubStatusPayload) => {
      if (mounted) {
        setStatus(payload)
        setLoading(false)
      }
    })
      .then((unlisten) => {
        if (!mounted) {
          unlisten()
        } else {
          unlistenRef.current = unlisten
        }
      })
      .catch((error) => {
        logger.error('[useGithubIntegration] Failed to register GitHub status listener', error)
      })

    return () => {
      mounted = false
      if (unlistenRef.current) {
        try {
          unlistenRef.current()
        } catch (error) {
          logger.warn('[useGithubIntegration] Failed to remove GitHub status listener', error)
        }
      }
    }
  }, [refreshStatus])

  const authenticate = useCallback(async () => {
    setIsAuthenticating(true)
    try {
      const result = await invoke<GitHubStatusPayload>(TauriCommands.GitHubAuthenticate)
      setStatus(result)
      setLoading(false)
      return result
    } catch (error) {
      const message = resolveErrorMessage(error)
      logger.error('[useGithubIntegration] GitHub authentication failed', message)
      throw new Error(message)
    } finally {
      setIsAuthenticating(false)
    }
  }, [])

  const connectProject = useCallback(async () => {
    setIsConnecting(true)
    try {
      const repository = await invoke<GitHubRepositoryPayload>(TauriCommands.GitHubConnectProject)
      setStatus((prev) => ({
        installed: prev?.installed ?? true,
        authenticated: prev?.authenticated ?? false,
        userLogin: prev?.userLogin ?? null,
        repository,
      }))
      setLoading(false)
      return repository
    } catch (error) {
      const message = resolveErrorMessage(error)
      logger.error('[useGithubIntegration] Failed to connect project to GitHub', message)
      throw new Error(message)
    } finally {
      setIsConnecting(false)
    }
  }, [])

  const createReviewedPr = useCallback(
    async (args: CreateReviewedPrArgs) => {
      const sessionKey = args.sessionId || args.sessionSlug
      setCreating((prev) => ({ ...prev, [sessionKey]: true }))

      const repositoryName = args.repository ?? status?.repository?.nameWithOwner
      const defaultBranch = args.defaultBranch ?? status?.repository?.defaultBranch ?? 'main'

      try {
        const payload = await invoke<GitHubPrPayload>(TauriCommands.GitHubCreateReviewedPr, {
          args: {
            sessionSlug: args.sessionSlug,
            worktreePath: args.worktreePath,
            defaultBranch,
            commitMessage: args.commitMessage,
            repository: repositoryName,
          }
        })

        setLastPrUrls((prev) => ({ ...prev, [sessionKey]: payload.url }))
        return payload
      } catch (error) {
        const message = resolveErrorMessage(error)
        logger.error('[useGithubIntegration] Failed to create GitHub PR', message)
        throw new Error(message)
      } finally {
        setCreating((prev) => {
          const next = { ...prev }
          delete next[sessionKey]
          return next
        })
      }
    },
    [status]
  )

  const isCreatingPr = useCallback((sessionId: string) => Boolean(creating[sessionId]), [creating])

  const getCachedPrUrl = useCallback((sessionId: string) => lastPrUrls[sessionId], [lastPrUrls])

  const value = useMemo<GithubIntegrationValue>(() => {
    const installed = Boolean(status?.installed)
    const authenticated = Boolean(status?.authenticated)
    const hasRepository = Boolean(status?.repository)

    return {
      status,
      loading,
      isAuthenticating,
      isConnecting,
      isCreatingPr,
      authenticate,
      connectProject,
      createReviewedPr,
      getCachedPrUrl,
      canCreatePr: installed && authenticated && hasRepository,
      isGhMissing: status ? !status.installed : false,
      hasRepository,
      refreshStatus,
    }
  }, [
    status,
    loading,
    isAuthenticating,
    isConnecting,
    isCreatingPr,
    authenticate,
    connectProject,
    createReviewedPr,
    getCachedPrUrl,
    refreshStatus,
  ])

  return value
}
