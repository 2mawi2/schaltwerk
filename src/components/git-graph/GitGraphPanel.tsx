import { useState, useEffect, useMemo, memo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { useProject } from '../../contexts/ProjectContext'
import { HistoryList } from './HistoryList'
import { toViewModel } from './graphLayout'
import type { HistoryProviderSnapshot } from './types'
import { logger } from '../../utils/logger'

export const GitGraphPanel = memo(() => {
  const { projectPath } = useProject()
  const [snapshot, setSnapshot] = useState<HistoryProviderSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectPath) {
      setSnapshot(null)
      setIsLoading(false)
      return
    }

    const fetchHistory = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await invoke<HistoryProviderSnapshot>(TauriCommands.GetGitGraphHistory, {
          repoPath: projectPath
        })
        logger.debug('[GitGraphPanel] Received history data:', {
          itemCount: result.items.length,
          firstFewItems: result.items.slice(0, 3).map(item => ({
            id: item.id,
            parentIds: item.parentIds,
            subject: item.subject,
            refCount: item.references?.length || 0
          }))
        })
        setSnapshot(result)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        logger.error('[GitGraphPanel] Failed to fetch git history', err)
        setError(errorMsg)
      } finally {
        setIsLoading(false)
      }
    }

    fetchHistory()
  }, [projectPath])

  const historyItems = useMemo(() => {
    return snapshot ? toViewModel(snapshot) : []
  }, [snapshot])

  if (!projectPath) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-xs">
        No project selected
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-xs">
        Loading git history...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-400 text-xs p-4">
        <div className="mb-2">Failed to load git history</div>
        <div className="text-slate-500 text-[10px] max-w-md text-center break-words">{error}</div>
      </div>
    )
  }

  if (historyItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-xs">
        No git history available
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-panel">
      <HistoryList items={historyItems} />
    </div>
  )
})

GitGraphPanel.displayName = 'GitGraphPanel'
