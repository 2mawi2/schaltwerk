import { useState, useEffect } from 'react'
import { VscFolderOpened, VscHistory, VscWarning, VscTrash, VscNewFolder } from 'react-icons/vsc'
import { AsciiBuilderLogo } from './AsciiBuilderLogo'
import { NewProjectDialog } from './NewProjectDialog'
import { getHomeLogoPositionStyles, getContentAreaStyles } from '../../constants/layout'
import { theme } from '../../common/theme'
import { formatDateTime } from '../../utils/dateTime'
import { useRecentProjects } from '../../hooks/useRecentProjects'

const RECENT_PROJECT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium'
}

interface HomeScreenProps {
  onOpenProject: (_path: string) => void
}

export function HomeScreen({ onOpenProject }: HomeScreenProps) {
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false)
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
    loadRecentProjects()
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
            handleOpenRecent(recentProjects[projectIndex])
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
                        ⌘{index + 1}
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
