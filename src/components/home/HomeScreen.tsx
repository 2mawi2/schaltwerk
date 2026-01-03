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
import { formatDateTime } from '../../utils/dateTime'
import { detectPlatformSafe } from '../../keyboardShortcuts/helpers'
import { useRecentProjects } from '../../hooks/useRecentProjects'

const RECENT_PROJECT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium'
}

interface HomeScreenProps {
  onOpenProject: (_path: string) => void
  initialError?: string | null
  onClearInitialError?: () => void
}

export function HomeScreen({ onOpenProject, initialError, onClearInitialError }: HomeScreenProps) {
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
  } = useRecentProjects({
    onOpenProject,
    onOperationSuccess: onClearInitialError
  })

  const displayError = error ?? initialError

  useEffect(() => {
    void loadRecentProjects()
  }, [loadRecentProjects])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modPressed = event.metaKey || event.ctrlKey
      if (modPressed && !event.shiftKey && !event.altKey) {
        const num = Number.parseInt(event.key, 10)
        const fallback = event.code?.match(/^(?:Digit|Numpad)([1-9])$/)
        const fallbackKeyCode =
          typeof event.keyCode === 'number' && event.keyCode >= 49 && event.keyCode <= 57
            ? event.keyCode - 48
            : typeof event.keyCode === 'number' && event.keyCode >= 97 && event.keyCode <= 105
              ? event.keyCode - 96
              : NaN

        const resolvedNum = Number.isNaN(num)
          ? Number.isNaN(fallbackKeyCode)
            ? (fallback ? Number.parseInt(fallback[1], 10) : NaN)
            : fallbackKeyCode
          : num

        if (resolvedNum >= 1 && resolvedNum <= 9) {
          const projectIndex = resolvedNum - 1
          if (projectIndex < recentProjects.length) {
            event.preventDefault()
            event.stopPropagation()
            if (typeof event.stopImmediatePropagation === 'function') {
              event.stopImmediatePropagation()
            }
            void handleOpenRecent(recentProjects[projectIndex])
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [recentProjects, handleOpenRecent])

  const handleProjectCreated = async (projectPath: string) => {
    setError(null)
    onClearInitialError?.()
    await loadRecentProjects()
    onOpenProject(projectPath)
  }

  const handleProjectCloned = (projectPath: string, shouldOpen: boolean) => {
    setError(null)
    onClearInitialError?.()
    void loadRecentProjects().then(() => {
      if (shouldOpen) {
        onOpenProject(projectPath)
      }
    })
  }

  return (
    <div
      className="w-full"
      style={{ backgroundColor: 'var(--color-bg-primary)' }}
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
          {displayError && (
            <div className="p-4 bg-red-950/50 border border-red-800 rounded-lg flex items-start gap-3">
              <VscWarning className="text-red-400 text-xl flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-sm">{displayError}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <button
              onClick={() => setShowNewProjectDialog(true)}
              className="py-4 px-6 rounded-lg flex items-center justify-center gap-3 group"
              style={{
                backgroundColor: 'var(--color-accent-green-bg)',
                border: '1px solid var(--color-accent-green-border)',
                color: 'var(--color-accent-green)'
              }}
            >
              <VscNewFolder className="text-2xl" />
              <span className="text-lg font-medium">New Project</span>
            </button>
            <button
              onClick={() => { void handleSelectDirectory() }}
              className="py-4 px-6 rounded-lg flex items-center justify-center gap-3 group"
              style={{
                backgroundColor: 'var(--color-accent-blue-bg)',
                border: '1px solid var(--color-accent-blue-border)',
                color: 'var(--color-accent-blue)'
              }}
            >
              <VscFolderOpened className="text-2xl" />
              <span className="text-lg font-medium">Open Repository</span>
            </button>
            <button
              onClick={() => setShowCloneDialog(true)}
              className="py-4 px-6 rounded-lg flex items-center justify-center gap-3 group"
              style={{
                backgroundColor: 'var(--color-accent-purple-bg)',
                border: '1px solid var(--color-accent-purple-border)',
                color: 'var(--color-accent-purple)'
              }}
            >
              <VscRepoClone className="text-2xl" />
              <span className="text-lg font-medium">Clone from Git</span>
            </button>
          </div>

          {recentProjects.length > 0 && (
            <section className="flex flex-col gap-4">
              <div
                className="flex items-center gap-2"
                style={{ color: 'var(--color-text-muted)' }}
              >
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
                    className="rounded-md px-3 py-2.5 group relative border transition-all duration-200 cursor-pointer"
                    style={{
                      backgroundColor: 'rgb(var(--color-bg-elevated-rgb) / 0.5)',
                      borderColor: 'var(--color-border-subtle)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgb(var(--color-bg-hover-rgb) / 0.6)'
                      e.currentTarget.style.borderColor = 'var(--color-border-strong)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgb(var(--color-bg-elevated-rgb) / 0.5)'
                      e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
                    }}
                  >
                    {index < 9 && (
                      <div className="absolute top-2 right-2 transition-opacity group-hover:opacity-0">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: 'rgb(var(--color-bg-hover-rgb) / 0.6)',
                            color: 'var(--color-text-tertiary)'
                          }}
                        >
                          {platform === 'mac' ? `⌘${index + 1}` : `Ctrl+${index + 1}`}
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
                            color: 'var(--color-text-muted)',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-accent-blue)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
                        />
                        <div className="flex-1 min-w-0 pr-8">
                          <h3
                            className="font-semibold truncate text-sm"
                            style={{ color: 'var(--color-text-primary)' }}
                          >
                            {project.name}
                          </h3>
                          <p
                            className="text-xs truncate mt-1"
                            style={{ color: 'var(--color-text-tertiary)' }}
                          >
                            {project.path}
                          </p>
                          <p
                            className="text-xs mt-1.5"
                            style={{ color: 'var(--color-text-muted)' }}
                          >
                            {formatDateTime(project.lastOpened, RECENT_PROJECT_DATE_OPTIONS)}
                          </p>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => { void handleRemoveProject(project, e) }}
                      className="absolute top-2 right-2 p-1 transition-colors opacity-0 group-hover:opacity-100"
                      style={{ color: 'var(--color-text-tertiary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-accent-red)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)' }}
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
