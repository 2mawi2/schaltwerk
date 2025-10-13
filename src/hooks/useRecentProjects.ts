import { useState, useCallback } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { logger } from '../utils/logger'

export interface RecentProject {
  path: string
  name: string
  lastOpened: number
}

interface UseRecentProjectsOptions {
  onOpenProject: (path: string) => void
  onOperationSuccess?: () => void
}

export function useRecentProjects({ onOpenProject, onOperationSuccess }: UseRecentProjectsOptions) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadRecentProjects = useCallback(async () => {
    try {
      const projects = await invoke<RecentProject[]>(TauriCommands.GetRecentProjects)
      setRecentProjects(projects.sort((a, b) => b.lastOpened - a.lastOpened))
    } catch (err) {
      logger.error('Failed to load recent projects:', err)
    }
  }, [])

  const handleOpenRecent = useCallback(async (project: RecentProject) => {
    setError(null)

    try {
      const exists = await invoke<boolean>(TauriCommands.DirectoryExists, {
        path: project.path
      })

      if (!exists) {
        setError(`Project directory no longer exists: ${project.path}`)
        await invoke(TauriCommands.RemoveRecentProject, { path: project.path })
        await loadRecentProjects()
        return
      }

      const isGitRepo = await invoke<boolean>(TauriCommands.IsGitRepository, {
        path: project.path
      })

      if (!isGitRepo) {
        setError('Selected directory is no longer a Git repository.')
        await invoke(TauriCommands.RemoveRecentProject, { path: project.path })
        await loadRecentProjects()
        return
      }

      await invoke(TauriCommands.UpdateRecentProjectTimestamp, { path: project.path })
      onOpenProject(project.path)
      onOperationSuccess?.()
    } catch (err) {
      logger.error('Failed to open recent project:', err)
      setError(`Failed to open project: ${err}`)
    }
  }, [onOpenProject, onOperationSuccess, loadRecentProjects])

  const handleSelectDirectory = useCallback(async () => {
    setError(null)

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Git Repository'
      })

      if (!selected) return

      const isGitRepo = await invoke<boolean>(TauriCommands.IsGitRepository, {
        path: selected
      })

      if (!isGitRepo) {
        setError('Selected directory is not a Git repository. Please select a valid Git repository.')
        return
      }

      await invoke(TauriCommands.AddRecentProject, { path: selected })
      onOpenProject(selected as string)
      onOperationSuccess?.()
    } catch (err) {
      logger.error('Failed to select directory:', err)
      setError(`Failed to open directory: ${err}`)
    }
  }, [onOpenProject, onOperationSuccess])

  const handleRemoveProject = useCallback(async (project: RecentProject, event: React.MouseEvent) => {
    event.stopPropagation()
    setError(null)

    try {
      await invoke(TauriCommands.RemoveRecentProject, { path: project.path })
      await loadRecentProjects()
    } catch (err) {
      logger.error('Failed to remove project:', err)
      setError(`Failed to remove project: ${err}`)
    }
  }, [loadRecentProjects])

  return {
    recentProjects,
    error,
    setError,
    loadRecentProjects,
    handleOpenRecent,
    handleSelectDirectory,
    handleRemoveProject
  }
}
