import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { VscFolderOpened, VscClose, VscNewFolder } from 'react-icons/vsc'
import { homeDir } from '@tauri-apps/api/path'
import { AnimatedText } from '../common/AnimatedText'
import { theme } from '../../common/theme'

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

  const initializeParentPath = async () => {
    if (!parentPath) {
      try {
        const home = await homeDir()
        setParentPath(home)
      } catch (err) {
        console.error('Failed to get home directory:', err)
      }
    }
  }

  const handleSelectDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Parent Directory'
      })

      if (selected) {
        setParentPath(selected as string)
      }
    } catch (err) {
      console.error('Failed to select directory:', err)
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
      const projectPath = await invoke<string>('create_new_project', {
        name: projectName.trim(),
        parentPath
      })

      onProjectCreated(projectPath)
      onClose()
    } catch (err) {
      console.error('Failed to create project:', err)
      setError(`Failed to create project: ${err}`)
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isCreating) {
      handleCreate()
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!isOpen) return null

  if (isOpen && !parentPath) {
    initializeParentPath()
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div 
        className="bg-slate-900 border border-slate-800 rounded-lg p-6 max-w-md w-full mx-4"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <VscNewFolder className="text-cyan-400 text-2xl" />
            <h2 className="text-xl font-semibold text-slate-200">New Project</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors"
            disabled={isCreating}
          >
            <VscClose className="text-xl" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950/50 border border-red-800 rounded text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Project Name
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="my-awesome-project"
              className="w-full px-3 py-2 bg-slate-950/50 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600"
              autoFocus
              disabled={isCreating}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Parent Directory
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={parentPath}
                readOnly
                placeholder="Select parent directory..."
                className="flex-1 px-3 py-2 bg-slate-950/50 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500"
                disabled={isCreating}
              />
              <button
                onClick={handleSelectDirectory}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg flex items-center gap-2 transition-colors"
                disabled={isCreating}
              >
                <VscFolderOpened className="text-lg" />
                Browse
              </button>
            </div>
          </div>

          <div className="bg-slate-950/30 border border-slate-800 rounded-lg p-3 text-sm text-slate-400">
            <p>This will create a new folder and initialize a Git repository.</p>
            {projectName && parentPath && (
              <p className="mt-2 text-cyan-300 font-mono text-xs">
                {parentPath}/{projectName}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg transition-colors"
            disabled={isCreating}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isCreating || !projectName.trim() || !parentPath}
            className="flex-1 py-2 px-4 bg-cyan-900/50 hover:bg-cyan-800/50 border border-cyan-700/50 text-cyan-300 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
{isCreating ? (
              <AnimatedText text="creating" colorClassName={theme.colors.text.muted} size="xs" />
            ) : (
              'Create Project'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}