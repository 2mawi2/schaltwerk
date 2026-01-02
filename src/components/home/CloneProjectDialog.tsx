import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { homeDir } from '@tauri-apps/api/path'
import { VscClose, VscFolderOpened, VscRepoClone } from 'react-icons/vsc'
import { TauriCommands } from '../../common/tauriCommands'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { logger } from '../../utils/logger'
import { parseGitRemote, sanitizeFolderName } from '../../utils/gitRemote'

const REMOTE_PLACEHOLDER = 'git@github.com:org/repo.git or https://github.com/org/repo.git'

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

interface CloneProjectDialogProps {
  isOpen: boolean
  onClose: () => void
  onProjectCloned: (_path: string, _shouldOpen: boolean) => void
}

export function CloneProjectDialog({ isOpen, onClose, onProjectCloned }: CloneProjectDialogProps) {
  const [remoteUrl, setRemoteUrl] = useState('')
  const [parentDirectory, setParentDirectory] = useState('')
  const [isCloning, setIsCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progressMessage, setProgressMessage] = useState<string | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const hasHydratedParent = useRef(false)

  const remoteMeta = useMemo(() => parseGitRemote(remoteUrl), [remoteUrl])
  const derivedFolderName = useMemo(
    () => sanitizeFolderName(remoteMeta.repoName ?? ''),
    [remoteMeta.repoName]
  )
  const isFormValid =
    remoteMeta.isValid && Boolean(parentDirectory.trim()) && Boolean(derivedFolderName)
  const targetPath =
    parentDirectory && derivedFolderName
      ? `${parentDirectory.replace(/\/+$/, '')}/${derivedFolderName}`
      : ''

  useEffect(() => {
    if (!isOpen) {
      requestIdRef.current = null
      setIsCloning(false)
      setProgressMessage(null)
      return
    }

    setRemoteUrl('')
    setError(null)
    setProgressMessage(null)
    requestIdRef.current = null

    let isCancelled = false

    const hydrateState = async () => {
      try {
        const storedParent = await invoke<string | null>(TauriCommands.GetLastProjectParentDirectory)

        if (!isCancelled && storedParent && storedParent.trim().length > 0) {
          setParentDirectory(storedParent)
          hasHydratedParent.current = true
          return
        }
      } catch (err) {
        if (!isCancelled) {
          logger.error('Failed to load clone dialog defaults:', err)
        }
      }

      if (isCancelled || hasHydratedParent.current) {
        return
      }

      try {
        const home = await homeDir()
        if (!isCancelled) {
          setParentDirectory(home)
          hasHydratedParent.current = true
        }
      } catch (homeError) {
        if (!isCancelled) {
          logger.error('Failed to determine home directory for clone dialog:', homeError)
        }
      }
    }

    void hydrateState()

    return () => {
      isCancelled = true
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    let unsubscribe: (() => void) | null = null

    const registerListener = async () => {
      try {
        unsubscribe = await listenEvent(SchaltEvent.CloneProgress, (payload) => {
          if (payload.requestId !== requestIdRef.current) {
            return
          }
          setProgressMessage(payload.message)
          if (payload.kind === 'error') {
            setError(payload.message)
            setIsCloning(false)
          }
        })
      } catch (err) {
        logger.error('Failed to subscribe to clone progress events:', err)
      }
    }

    void registerListener()

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [isOpen])

  const handleSelectDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Destination Folder'
      })

      if (selected) {
        setParentDirectory(selected as string)
        hasHydratedParent.current = true
      }
    } catch (err) {
      logger.error('Failed to select clone destination:', err)
      setError(`Failed to select directory: ${err}`)
    }
  }

  const handleClone = async () => {
    const trimmedRemote = remoteUrl.trim()
    const trimmedFolder = derivedFolderName
    if (!remoteMeta.isValid || !trimmedRemote || !parentDirectory || !trimmedFolder) {
      setError('Please provide a valid Git remote URL and destination.')
      return
    }

    setIsCloning(true)
    setError(null)
    setProgressMessage('Starting clone...')

    const requestId = generateRequestId()
    requestIdRef.current = requestId

    try {
      await invoke(TauriCommands.SetLastProjectParentDirectory, { path: parentDirectory })
    } catch (persistError) {
      logger.error('Failed to persist parent directory before clone:', persistError)
    }

    try {
      const result = await invoke<{
        projectPath: string
        defaultBranch?: string | null
        remote: string
      }>(TauriCommands.SchaltwerkCoreCloneProject, {
        remoteUrl: trimmedRemote,
        parentDirectory,
        folderName: trimmedFolder,
        requestId
      })

      onProjectCloned(result.projectPath, true)
      onClose()
    } catch (err) {
      logger.error('Failed to clone repository:', err)
      setError(`Failed to clone repository: ${err}`)
    } finally {
      setIsCloning(false)
      requestIdRef.current = null
    }
  }

  if (!isOpen) {
    return null
  }

  const helperText = remoteMeta.kind === 'ssh'
    ? 'SSH remote detected. Ensure your ssh-agent is running with the appropriate key loaded.'
    : remoteMeta.kind === 'https'
      ? 'HTTPS remote detected. Credentials will be requested through your Git credential helper.'
      : 'Enter a valid SSH or HTTPS Git URL.'

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: 'var(--color-overlay-backdrop)' }}
    >
      <div
        className="w-full max-w-2xl mx-4 border rounded-lg shadow-xl"
        style={{ backgroundColor: 'var(--color-bg-tertiary)', borderColor: 'var(--color-border-default)' }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--color-border-default)' }}>
          <div className="flex items-center gap-3">
            <VscRepoClone className="text-2xl" style={{ color: 'var(--color-accent-blue)' }} />
            <div>
              <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>Clone Git Repository</h2>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Clone a remote repository into a new Schaltwerk project</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded"
            style={{ color: 'var(--color-text-muted)' }}
            disabled={isCloning}
          >
            <VscClose className="text-lg" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {error && (
            <div
              className="p-3 rounded text-sm"
              style={{
                backgroundColor: 'var(--color-accent-red-bg)',
                border: '1px solid var(--color-accent-red-border)',
                color: 'var(--color-accent-red)'
              }}
            >
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
              htmlFor="clone-remote-url"
            >
              Remote URL
            </label>
            <input
              type="text"
              id="clone-remote-url"
              value={remoteUrl}
              onChange={(event) => setRemoteUrl(event.target.value)}
              placeholder={REMOTE_PLACEHOLDER}
              className="w-full px-3 py-2 rounded-lg"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)'
              }}
              autoFocus
              spellCheck={false}
              disabled={isCloning}
            />
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {helperText}
            </p>
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
              htmlFor="clone-parent-directory"
            >
              Parent Directory
            </label>
            <div className="flex gap-2 flex-col md:flex-row">
              <input
                type="text"
                id="clone-parent-directory"
                value={parentDirectory}
                readOnly
                className="flex-1 px-3 py-2 rounded-lg"
                style={{
                  backgroundColor: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-primary)'
                }}
              />
              <button
                onClick={() => { void handleSelectDirectory() }}
                className="px-3 py-2 rounded-lg flex items-center gap-2"
                style={{
                  backgroundColor: 'var(--color-bg-hover)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-primary)'
                }}
                disabled={isCloning}
              >
                <VscFolderOpened className="text-lg" />
                Browse
              </button>
            </div>
          </div>

          <div
            className="rounded-lg px-4 py-3 space-y-1"
            style={{
              backgroundColor: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border-subtle)'
            }}
          >
            <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
              Destination Folder
            </p>
            <p className="font-mono text-sm truncate" style={{ color: 'var(--color-text-primary)' }}>
              {targetPath || 'Select a valid remote and parent directory'}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              The folder name is derived from the repository name. You can rename it later if needed.
            </p>
          </div>

          {progressMessage && (
            <div
              className="text-sm font-mono px-3 py-2 rounded"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                color: 'var(--color-text-secondary)'
              }}
            >
              {progressMessage}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-6 py-4 border-t" style={{ borderColor: 'var(--color-border-default)' }}>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg transition-colors"
            style={{
              backgroundColor: 'var(--color-bg-hover)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-primary)'
            }}
            disabled={isCloning}
          >
            Cancel
          </button>
          <button
            onClick={() => { void handleClone() }}
            className="flex-1 px-4 py-2 rounded-lg flex justify-center"
            style={{
              backgroundColor: 'var(--color-accent-blue-bg)',
              border: '1px solid var(--color-accent-blue-border)',
              color: 'var(--color-accent-blue)',
              opacity: !isFormValid || isCloning ? 0.6 : 1
            }}
            disabled={!isFormValid || isCloning}
          >
            {isCloning ? 'Cloning…' : 'Clone Project'}
          </button>
        </div>
      </div>
    </div>
  )
}
