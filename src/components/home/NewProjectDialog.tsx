import { useEffect, useState } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { VscFolderOpened, VscClose, VscNewFolder } from 'react-icons/vsc'
import { homeDir } from '@tauri-apps/api/path'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'

interface NewProjectDialogProps {
  isOpen: boolean
  onClose: () => void
  onProjectCreated: (_path: string) => void
}

export function NewProjectDialog({ isOpen, onClose, onProjectCreated }: NewProjectDialogProps) {
  const [projectName, setProjectName] = useState('')
  const [parentPath, setParentPath] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || parentPath) {
      return
    }

    let isCancelled = false

    const hydrateParentPath = async () => {
      try {
        const persisted = await invoke<string | null>(TauriCommands.GetLastProjectParentDirectory)
        if (!isCancelled && persisted && persisted.trim().length > 0) {
          setParentPath(persisted)
          return
        }
      } catch (err) {
        logger.error('Failed to load last project parent directory:', err)
      }

      try {
        const home = await homeDir()
        if (!isCancelled) {
          setParentPath(home)
        }
      } catch (err) {
        if (!isCancelled) {
          logger.error('Failed to get home directory:', err)
        }
      }
    }

    void hydrateParentPath()

    return () => {
      isCancelled = true
    }
  }, [isOpen, parentPath])

  const handleSelectDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Parent Directory'
      })

      if (selected) {
        const selectedPath = selected as string
        setParentPath(selectedPath)
        try {
          await invoke(TauriCommands.SetLastProjectParentDirectory, { path: selectedPath })
        } catch (persistError) {
          logger.error('Failed to persist selected parent directory:', persistError)
        }
      }
    } catch (err) {
      logger.error('Failed to select directory:', err)
      setError(`Failed to select directory: ${err}`)
    }
  }

  const handleCreate = async () => {
    if (!projectName.trim()) {
      setError('Please enter a project name')
      return
    }

    if (!parentPath) {
      setError('Please select a parent directory')
      return
    }

    const invalidChars = /[<>:"|?*/\\]/
    if (invalidChars.test(projectName)) {
      setError('Project name contains invalid characters')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      try {
        await invoke(TauriCommands.SetLastProjectParentDirectory, { path: parentPath })
      } catch (persistError) {
        logger.error('Failed to persist parent directory before creating project:', persistError)
      }

      const projectPath = await invoke<string>(TauriCommands.CreateNewProject, {
        name: projectName.trim(),
        parentPath
      })

      onProjectCreated(projectPath)
      onClose()
    } catch (err) {
      logger.error('Failed to create project:', err)
      setError(`Failed to create project: ${err}`)
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isCreating) {
      void handleCreate()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div
        className="rounded-lg p-6 max-w-md w-full mx-4 border"
        style={{
          backgroundColor: 'var(--color-bg-secondary)',
          borderColor: 'var(--color-border-default)'
        }}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <VscNewFolder className="text-2xl" style={{ color: 'var(--color-accent-cyan)' }} />
            <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>New Project</h2>
          </div>
          <button
            onClick={onClose}
            className="transition-colors"
            style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
            disabled={isCreating}
          >
            <VscClose className="text-xl" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded text-sm border" style={{
            backgroundColor: 'var(--color-accent-red-bg)',
            borderColor: 'var(--color-accent-red-border)',
            color: 'var(--color-accent-red)'
          }}>
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Project Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="my-awesome-project"
              className="w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-1"
              style={{
                backgroundColor: 'var(--color-bg-primary)',
                borderColor: 'var(--color-border-default)',
                color: 'var(--color-text-primary)'
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-accent-cyan)'
                e.currentTarget.style.boxShadow = `0 0 0 1px var(--color-accent-cyan)`
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border-default)'
                e.currentTarget.style.boxShadow = 'none'
              }}
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={isCreating}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Parent Directory
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={parentPath}
                readOnly
                placeholder="Select parent directory..."
                className="flex-1 px-3 py-2 rounded-lg border"
                style={{
                  backgroundColor: 'var(--color-bg-primary)',
                  borderColor: 'var(--color-border-default)',
                  color: 'var(--color-text-primary)'
                }}
                disabled={isCreating}
              />
              <button
                onClick={() => { void handleSelectDirectory() }}
                className="px-4 py-2 rounded-lg flex items-center gap-2 transition-colors border"
                style={{
                  backgroundColor: 'var(--color-bg-elevated)',
                  borderColor: 'var(--color-border-default)',
                  color: 'var(--color-text-secondary)'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-elevated)' }}
                disabled={isCreating}
              >
                <VscFolderOpened className="text-lg" />
                Browse
              </button>
            </div>
          </div>

          <div className="rounded-lg p-3 text-sm border" style={{
            backgroundColor: 'var(--color-bg-primary)',
            borderColor: 'var(--color-border-default)',
            color: 'var(--color-text-secondary)'
          }}>
            <p>This will create a new folder and initialize a Git repository.</p>
            {projectName && parentPath && (
              <p className="mt-2 font-mono text-xs" style={{ color: 'var(--color-accent-cyan)' }}>
                {parentPath}/{projectName}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 rounded-lg transition-colors border"
            style={{
              backgroundColor: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border-default)',
              color: 'var(--color-text-secondary)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-elevated)' }}
            disabled={isCreating}
          >
            Cancel
          </button>
          <button
            onClick={() => { void handleCreate() }}
            disabled={isCreating || !projectName.trim() || !parentPath}
            className="flex-1 py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border"
            style={{
              backgroundColor: 'var(--color-accent-cyan-bg)',
              borderColor: 'var(--color-accent-cyan-border)',
              color: 'var(--color-accent-cyan)'
            }}
            onMouseEnter={(e) => {
              if (!isCreating && projectName.trim() && parentPath) {
                e.currentTarget.style.backgroundColor = 'var(--color-accent-cyan-bg-hover)'
              }
            }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-accent-cyan-bg)' }}
          >
{isCreating ? (
              <AnimatedText text="loading" size="xs" />
            ) : (
              'Create Project'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
