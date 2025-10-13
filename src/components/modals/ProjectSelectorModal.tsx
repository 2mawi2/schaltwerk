import { useEffect } from 'react'
import { VscFolderOpened, VscTrash, VscClose } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import { formatDateTime } from '../../utils/dateTime'
import { useRecentProjects } from '../../hooks/useRecentProjects'

const RECENT_PROJECT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'medium'
}

interface ProjectSelectorModalProps {
  open: boolean
  onClose: () => void
  onOpenProject: (_path: string) => void
  openProjectPaths?: string[]
}

export function ProjectSelectorModal({ open: isOpen, onClose, onOpenProject, openProjectPaths = [] }: ProjectSelectorModalProps) {
  const {
    recentProjects,
    error,
    loadRecentProjects,
    handleOpenRecent,
    handleSelectDirectory,
    handleRemoveProject
  } = useRecentProjects({
    onOpenProject,
    onOperationSuccess: onClose
  })

  const availableProjects = recentProjects.filter(
    project => !openProjectPaths.includes(project.path)
  )

  useEffect(() => {
    if (isOpen) {
      loadRecentProjects()
    }
  }, [isOpen, loadRecentProjects])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation()
        }
        onClose()
        return
      }

      if (event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey) {
        const key = event.key
        const num = parseInt(key, 10)

        if (num >= 1 && num <= 9) {
          const projectIndex = num - 1
          if (projectIndex < availableProjects.length) {
            event.preventDefault()
            event.stopPropagation()
            if (typeof event.stopImmediatePropagation === 'function') {
              event.stopImmediatePropagation()
            }
            handleOpenRecent(availableProjects[projectIndex])
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, availableProjects, handleOpenRecent, onClose])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}
      onClick={onClose}
    >
      <div
        className="relative rounded-lg shadow-2xl max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden"
        style={{
          backgroundColor: theme.colors.background.primary,
          border: `1px solid ${theme.colors.border.default}`
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderBottomColor: theme.colors.border.default }}>
          <h2 className="text-lg font-semibold" style={{ color: theme.colors.text.primary }}>
            Open Project
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-elevated transition-colors"
            style={{ color: theme.colors.text.tertiary }}
            aria-label="Close"
          >
            <VscClose className="text-xl" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
          {error && (
            <div
              className="mb-4 p-3 rounded-lg flex items-start gap-3"
              style={{
                backgroundColor: theme.colors.accent.red.bg,
                border: `1px solid ${theme.colors.accent.red.border}`
              }}
            >
              <p className="text-sm" style={{ color: theme.colors.accent.red.DEFAULT }}>
                {error}
              </p>
            </div>
          )}

          <div className="mb-6">
            <button
              onClick={handleSelectDirectory}
              className="w-full py-3 px-4 rounded-lg flex items-center justify-center gap-3 transition-colors"
              style={{
                backgroundColor: theme.colors.accent.blue.bg,
                border: `1px solid ${theme.colors.accent.blue.border}`,
                color: theme.colors.accent.blue.DEFAULT
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = `${theme.colors.accent.blue.DEFAULT}22`
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = theme.colors.accent.blue.bg
              }}
            >
              <VscFolderOpened className="text-xl" />
              <span className="font-medium">Open Repository</span>
            </button>
          </div>

          {availableProjects.length > 0 && (
            <div>
              <h3 className="text-sm font-medium uppercase tracking-wider mb-3" style={{ color: theme.colors.text.muted }}>
                Recent Projects
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {availableProjects.map((project, index) => (
                  <div
                    key={project.path}
                    className="rounded-lg p-4 group relative transition-colors"
                    style={{
                      backgroundColor: theme.colors.background.secondary,
                      border: `1px solid ${theme.colors.border.subtle}`
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = theme.colors.background.elevated
                      e.currentTarget.style.borderColor = theme.colors.border.default
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = theme.colors.background.secondary
                      e.currentTarget.style.borderColor = theme.colors.border.subtle
                    }}
                  >
                    {index < 9 && (
                      <div className="absolute top-2 right-2 transition-opacity group-hover:opacity-0">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: `${theme.colors.background.elevated}80`,
                            color: theme.colors.text.muted
                          }}
                        >
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
                          className="text-lg flex-shrink-0 mt-0.5"
                          style={{ color: theme.colors.text.muted }}
                        />
                        <div className="flex-1 min-w-0 pr-8">
                          <h3 className="font-medium truncate text-sm" style={{ color: theme.colors.text.primary }}>
                            {project.name}
                          </h3>
                          <p className="text-xs truncate mt-1" style={{ color: theme.colors.text.muted }}>
                            {project.path}
                          </p>
                          <p className="text-xs mt-2" style={{ color: theme.colors.text.tertiary }}>
                            {formatDateTime(project.lastOpened, RECENT_PROJECT_DATE_OPTIONS)}
                          </p>
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => handleRemoveProject(project, e)}
                      className="absolute top-2 right-2 p-1 transition-all opacity-0 group-hover:opacity-100"
                      style={{ color: theme.colors.text.tertiary }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = theme.colors.accent.red.DEFAULT
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = theme.colors.text.tertiary
                      }}
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
  )
}
