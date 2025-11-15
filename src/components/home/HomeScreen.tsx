import { useState, useEffect } from 'react'
import { VscFolderOpened, VscHistory, VscWarning, VscTrash, VscNewFolder, VscRepoClone } from 'react-icons/vsc'
import { AsciiBuilderLogo } from './AsciiBuilderLogo'
import { NewProjectDialog } from './NewProjectDialog'
import { CloneProjectDialog } from './CloneProjectDialog'
import {
  getHomeLogoPositionStyles,
  getContentAreaStyles,
  getHomeContainerStyles,
  LAYOUT_CONSTANTS
} from '../../constants/layout'
import { theme } from '../../common/theme'
import { formatDateTime } from '../../utils/dateTime'
import { detectPlatformSafe } from '../../keyboardShortcuts/helpers'
import { useRecentProjects } from '../../hooks/useRecentProjects'

const RECENT_PROJECT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium'
}

interface HomeScreenProps {
  onOpenProject: (_path: string) => void
}

export function HomeScreen({ onOpenProject }: HomeScreenProps) {
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false)
  const [showCloneDialog, setShowCloneDialog] = useState(false)
  
  const platform = detectPlatformSafe()

  const {
    recentProjects,
    error,
    setError,
    loadRecentProjects,
    handleOpenRecent,
    handleSelectDirectory,
    handleRemoveProject
  } = useRecentProjects({ onOpenProject })

  useEffect(() => {
    void loadRecentProjects()
  }, [loadRecentProjects])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey) {
        const key = event.key
        const num = parseInt(key, 10)

        if (num >= 1 && num <= 9) {
          const projectIndex = num - 1
          if (projectIndex < recentProjects.length) {
            event.preventDefault()
            void handleOpenRecent(recentProjects[projectIndex])
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [recentProjects, handleOpenRecent])

  const handleProjectCreated = async (projectPath: string) => {
    setError(null)
    await loadRecentProjects()
    onOpenProject(projectPath)
  }

  const handleProjectCloned = (projectPath: string, shouldOpen: boolean) => {
    setError(null)
    void loadRecentProjects().then(() => {
      if (shouldOpen) {
        onOpenProject(projectPath)
      }
    })
  }

  return (
    <div
      className="w-full"
      style={{ backgroundColor: theme.colors.background.primary }}
    >
      <div style={getHomeContainerStyles()}>
        <div style={getHomeLogoPositionStyles()}>
          <div className="inline-flex items-center gap-3">
            <AsciiBuilderLogo idleMode="artifact" />
          </div>
        </div>

        <div
          className="flex w-full flex-col"
          style={getContentAreaStyles()}
        >
          {error && (
            <div className="p-4 bg-red-950/50 border border-red-800 rounded-lg flex items-start gap-3">
              <VscWarning className="text-red-400 text-xl flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <button
              onClick={() => setShowNewProjectDialog(true)}
              className="bg-emerald-900/30 hover:bg-emerald-800/40 border border-emerald-700/50 text-emerald-300 py-4 px-6 rounded-lg flex items-center justify-center gap-3 group"
            >
              <VscNewFolder className="text-2xl" />
              <span className="text-lg font-medium">New Project</span>
            </button>
            <button
              onClick={() => { void handleSelectDirectory() }}
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
            <button
              onClick={() => setShowCloneDialog(true)}
              className="py-4 px-6 rounded-lg flex items-center justify-center gap-3 group"
              style={{
                backgroundColor: theme.colors.accent.purple.bg,
                border: `1px solid ${theme.colors.accent.purple.border}`,
                color: theme.colors.accent.purple.DEFAULT
              }}
            >
              <VscRepoClone className="text-2xl" />
              <span className="text-lg font-medium">Clone from Git</span>
            </button>
          </div>

          {recentProjects.length > 0 && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-slate-400">
                <VscHistory className="text-lg" />
                <h2 className="text-sm font-medium uppercase tracking-wider">Recent Projects</h2>
              </div>

              <div
                className="grid grid-cols-1 gap-3 overflow-y-auto pr-2 custom-scrollbar md:grid-cols-2 lg:grid-cols-3"
                style={{ maxHeight: LAYOUT_CONSTANTS.HOME_RECENT_SCROLL_MAX_HEIGHT }}
              >
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
                      onClick={() => { void handleOpenRecent(project) }}
                      className="w-full text-left"
                    >
                      <div className="flex items-start gap-3">
                        <VscFolderOpened
                          className="transition-colors text-lg flex-shrink-0 mt-0.5"
                          style={{
                            color: theme.colors.text.muted,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = theme.colors.accent.blue.DEFAULT }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = theme.colors.text.muted }}
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
                      onClick={(e) => { void handleRemoveProject(project, e) }}
                      className="absolute top-2 right-2 p-1 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      title={`Remove ${project.name} from recent projects`}
                    >
                      <VscTrash className="text-sm" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      <NewProjectDialog
        isOpen={showNewProjectDialog}
        onClose={() => setShowNewProjectDialog(false)}
        onProjectCreated={(path) => { void handleProjectCreated(path) }}
      />
      <CloneProjectDialog
        isOpen={showCloneDialog}
        onClose={() => setShowCloneDialog(false)}
        onProjectCloned={(path, shouldOpen) => { handleProjectCloned(path, shouldOpen) }}
      />
    </div>
  )
}
