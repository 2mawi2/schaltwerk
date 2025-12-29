import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { useSelection } from './useSelection'
import { logger } from '../utils/logger'

interface UseOpenInEditorOptions {
  sessionNameOverride?: string | null
  isCommander?: boolean
}

export function useOpenInEditor(options: UseOpenInEditorOptions = {}) {
  const { sessionNameOverride, isCommander } = options
  const { selection } = useSelection()

  const sessionName = sessionNameOverride ?? (selection.kind === 'session' ? selection.payload : null)

  const openInEditor = useCallback(async (filePath: string) => {
    try {
      let basePath: string

      if (isCommander && !sessionName) {
        basePath = await invoke<string>(TauriCommands.GetActiveProjectPath)
      } else if (sessionName) {
        const sessionData = await invoke<{ worktree_path: string }>(TauriCommands.SchaltwerkCoreGetSession, { name: sessionName })
        basePath = sessionData.worktree_path
      } else {
        basePath = await invoke<string>(TauriCommands.GetActiveProjectPath)
      }

      const fullPath = `${basePath}/${filePath}`
      const defaultAppId = await invoke<string>(TauriCommands.GetDefaultOpenApp)
      await invoke(TauriCommands.OpenInApp, {
        appId: defaultAppId,
        worktreeRoot: basePath,
        worktreePath: basePath,
        targetPath: fullPath
      })
    } catch (e) {
      logger.error('Failed to open file in editor:', filePath, e)
      const errorMessage = typeof e === 'string' ? e : ((e as Error)?.message || String(e) || 'Unknown error')
      alert(errorMessage)
    }
  }, [sessionName, isCommander])

  return { openInEditor }
}
