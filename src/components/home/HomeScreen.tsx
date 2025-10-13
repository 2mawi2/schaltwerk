import { useState, useEffect, useCallback } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { VscFolderOpened, VscHistory, VscWarning, VscTrash, VscNewFolder } from 'react-icons/vsc'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { AsciiBuilderLogo } from './AsciiBuilderLogo'
import { NewProjectDialog } from './NewProjectDialog'
import { getHomeLogoPositionStyles, getContentAreaStyles } from '../../constants/layout'
import { logger } from '../../utils/logger'
import { theme } from '../../common/theme'
import { formatDateTime } from '../../utils/dateTime'
import { detectPlatformSafe } from '../../keyboardShortcuts/helpers'

const RECENT_PROJECT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium'
}

interface RecentProject {
  path: string
  name: string
  lastOpened: number
}

interface HomeScreenProps {
  onOpenProject: (_path: string) => void
}

export function HomeScreen({ onOpenProject }: HomeScreenProps) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false)
  
  const platform = detectPlatformSafe()


  const loadRecentProjects = async () => {
    try {
      const projects = await invoke<RecentProject[]>(TauriCommands.GetRecentProjects)
      setRecentProjects(projects.sort((a, b) => b.lastOpened - a.lastOpened))
    } catch (err) {
      logger.error('Failed to load recent projects:', err)
    }
  }

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
    } catch (err) {
      logger.error('Failed to open recent project:', err)
      setError(`Failed to open project: ${err}`)
    }
  }, [onOpenProject])

  useEffect(() => {
    loadRecentProjects()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey) {
        const key = event.key
        const num = parseInt(key, 10)

        if (num >= 1 && num <= 9) {
          const projectIndex = num - 1
          if (projectIndex < recentProjects.length) {
            event.preventDefault()
            handleOpenRecent(recentProjects[projectIndex])
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [recentProjects, handleOpenRecent])

  const handleSelectDirectory = async () => {
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
    } catch (err) {
      logger.error('Failed to select directory:', err)
      setError(`Failed to open directory: ${err}`)
    }
  }

  const handleRemoveProject = async (project: RecentProject, event: React.MouseEvent) => {
    event.stopPropagation() // Prevent opening the project when clicking remove
    setError(null)
    
    try {
      await invoke(TauriCommands.RemoveRecentProject, { path: project.path })
      await loadRecentProjects()
    } catch (err) {
      logger.error('Failed to remove project:', err)
      setError(`Failed to remove project: ${err}`)
    }
  }

  const handleProjectCreated = async (projectPath: string) => {
    setError(null)
    await loadRecentProjects()
    onOpenProject(projectPath)
  }


  return (
    <div className="h-screen w-screen bg-slate-950 relative">
      {/* Logo positioned higher for HomeScreen layout */}
      <div style={getHomeLogoPositionStyles()}>
         <div className="inline-flex items-center gap-3">
            <AsciiBuilderLogo idleMode="artifact" />
         </div>
      </div>

      {/* Content area positioned using layout constants for perfect centering */}
      <div style={getContentAreaStyles()}>
        <div className="flex flex-col items-center justify-center h-full p-8">
          <div className="max-w-4xl w-full">

        {error && (
          <div className="mb-6 p-4 bg-red-950/50 border border-red-800 rounded-lg flex items-start gap-3">
            <VscWarning className="text-red-400 text-xl flex-shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => setShowNewProjectDialog(true)}
            className="bg-emerald-900/30 hover:bg-emerald-800/40 border border-emerald-700/50 text-emerald-300 py-4 px-6 rounded-lg flex items-center justify-center gap-3 group"
          >
            <VscNewFolder className="text-2xl" />
            <span className="text-lg font-medium">New Project</span>
          </button>
           <button
             onClick={handleSelectDirectory}
             className="py-4 px-6 rounded-lg flex items-center justify-center gap-3 group"
             style={{
               backgroundColor: theme.colors.accent.blue.bg,
               border: `1px solid ${theme.colors.accent.blue.border}`,
               color: theme.colors.accent.blue.DEFAULT
             }}
           >
             <VscFolderOpened className="text-2xl" />
             <span className="text-lg font-medium">Open Repository</span>
           </button>
        </div>

        {recentProjects.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4 text-slate-400">
              <VscHistory className="text-lg" />
              <h2 className="text-sm font-medium uppercase tracking-wider">Recent Projects</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
              {recentProjects.map((project, index) => (
                <div
                  key={project.path}
                  className="bg-slate-900/50 hover:bg-slate-800/60 border border-slate-800 hover:border-slate-700 rounded-lg p-4 group relative"
                >
                  {index < 9 && (
                    <div className="absolute top-2 right-2 transition-opacity group-hover:opacity-0">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                        {platform === 'mac' ? `⌘${index + 1}` : `Ctrl + ${index + 1}`}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => handleOpenRecent(project)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start gap-3">
                       <VscFolderOpened
                         className="transition-colors text-lg flex-shrink-0 mt-0.5"
                         style={{
                           color: theme.colors.text.muted,
                         }}
                         onMouseEnter={(e) => e.currentTarget.style.color = theme.colors.accent.blue.DEFAULT}
                         onMouseLeave={(e) => e.currentTarget.style.color = theme.colors.text.muted}
                       />
                      <div className="flex-1 min-w-0 pr-8">
                        <h3 className="text-slate-200 font-medium truncate text-sm">
                          {project.name}
                        </h3>
                        <p className="text-slate-500 text-xs truncate mt-1">
                          {project.path}
                        </p>
                        <p className="text-slate-600 text-xs mt-2">
                          {formatDateTime(project.lastOpened, RECENT_PROJECT_DATE_OPTIONS)}
                        </p>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={(e) => handleRemoveProject(project, e)}
                    className="absolute top-2 right-2 p-1 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    title={`Remove ${project.name} from recent projects`}
                  >
                    <VscTrash className="text-sm" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
          </div>
        </div>
      </div>
      
      <NewProjectDialog
        isOpen={showNewProjectDialog}
        onClose={() => setShowNewProjectDialog(false)}
        onProjectCreated={handleProjectCreated}
      />
    </div>
  )
}
