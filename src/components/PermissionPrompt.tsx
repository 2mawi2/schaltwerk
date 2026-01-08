import { useEffect, useState, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useFolderPermission } from '../hooks/usePermissions'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from '../utils/logger'
import { useTranslation } from '../common/i18n'

type InstallKind = 'app-bundle' | 'homebrew' | 'justfile' | 'standalone' | 'other'

interface PermissionDiagnostics {
  bundleIdentifier: string
  executablePath: string
  installKind: InstallKind
  appDisplayName: string
}

interface PermissionPromptProps {
  onPermissionGranted?: () => void
  showOnlyIfNeeded?: boolean
  onRetryAgent?: () => void
  folderPath?: string
}

export function PermissionPrompt({ onPermissionGranted, showOnlyIfNeeded = true, onRetryAgent, folderPath }: PermissionPromptProps) {
  const { t } = useTranslation()
  const { hasPermission, isChecking, requestPermission, checkPermission, deniedPath } = useFolderPermission(folderPath)
  const [isRetrying, setIsRetrying] = useState(false)
  const [attemptCount, setAttemptCount] = useState(0)
  const [diagnostics, setDiagnostics] = useState<PermissionDiagnostics | null>(null)
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null)
  const [supportBusy, setSupportBusy] = useState<'open-settings' | 'reset-permission' | null>(null)
  const [supportMessage, setSupportMessage] = useState<string | null>(null)
  const [supportError, setSupportError] = useState<string | null>(null)
  
  // Extract folder name from path for display
  const displayPath = useMemo(() => {
    const path = deniedPath || folderPath || ''
    // Show abbreviated path if it's too long
    if (path.length > 50) {
      const parts = path.split('/')
      if (parts.length > 3) {
        return `.../${parts.slice(-3).join('/')}`
      }
    }
    return path
  }, [deniedPath, folderPath])

  const installLabel = useMemo(() => {
    if (!diagnostics) {
      return null
    }

    switch (diagnostics.installKind) {
      case 'app-bundle':
        return t.permissionPrompt.installLabels.appBundle
      case 'homebrew':
        return t.permissionPrompt.installLabels.homebrew
      case 'justfile':
        return t.permissionPrompt.installLabels.justfile
      case 'standalone':
        return t.permissionPrompt.installLabels.standalone
      default:
        return t.permissionPrompt.installLabels.other
    }
  }, [diagnostics, t])

  const installGuidance = useMemo(() => {
    if (!diagnostics) {
      return null
    }

    switch (diagnostics.installKind) {
      case 'app-bundle':
        return t.permissionPrompt.installGuidance.appBundle
      case 'homebrew':
        return t.permissionPrompt.installGuidance.homebrew
      case 'justfile':
        return t.permissionPrompt.installGuidance.justfile
      case 'standalone':
        return t.permissionPrompt.installGuidance.standalone
      default:
        return t.permissionPrompt.installGuidance.other
    }
  }, [diagnostics, t])

  useEffect(() => {
    let cancelled = false

    invoke<PermissionDiagnostics>(TauriCommands.GetPermissionDiagnostics)
      .then(info => {
        if (!cancelled) {
          setDiagnostics(info)
          setDiagnosticsError(null)
        }
      })
      .catch(error => {
        logger.warn('Failed to load permission diagnostics for folder access prompt', error)
        if (!cancelled) {
          setDiagnostics(null)
          setDiagnosticsError(String(error))
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (hasPermission === true && onPermissionGranted) {
      onPermissionGranted()
    }
  }, [hasPermission, onPermissionGranted])

  if (showOnlyIfNeeded && hasPermission === true) {
    return null
  }

  if (isChecking && attemptCount === 0) {
    return null
  }

  const handleRequestPermission = async () => {
    if (!deniedPath && !folderPath) return
    
    setSupportMessage(null)
    setSupportError(null)
    setIsRetrying(true)
    setAttemptCount(prev => prev + 1)
    
    const pathToRequest = deniedPath || folderPath || ''
    const granted = await requestPermission(pathToRequest)
    
    if (!granted) {
      setTimeout(() => {
        void (async () => {
          const recheckGranted = await checkPermission(pathToRequest)
          if (recheckGranted && onPermissionGranted) {
            onPermissionGranted()
          }
          setIsRetrying(false)
        })()
      }, 1000)
    } else {
      setIsRetrying(false)
    }
  }

  const handleRetryCheck = async () => {
    if (!deniedPath && !folderPath) return
    
    setSupportMessage(null)
    setSupportError(null)
    setIsRetrying(true)
    const pathToCheck = deniedPath || folderPath || ''
    const granted = await checkPermission(pathToCheck)
    if (granted && onPermissionGranted) {
      onPermissionGranted()
    }
    setIsRetrying(false)
  }

  const handleOpenSystemSettings = async () => {
    setSupportBusy('open-settings')
    setSupportMessage(null)
    setSupportError(null)

    try {
      await invoke(TauriCommands.OpenDocumentsPrivacySettings)
      setSupportMessage(t.permissionPrompt.supportMessages.settingsOpened)
    } catch (error) {
      logger.error('Failed to open macOS System Settings for folder permissions', error)
      setSupportError(`Failed to open System Settings: ${error}`)
    } finally {
      setSupportBusy(null)
    }
  }

  const handleResetPermissions = async () => {
    setSupportBusy('reset-permission')
    setSupportMessage(null)
    setSupportError(null)

    try {
      await invoke(TauriCommands.ResetFolderPermissions)
      setSupportMessage(t.permissionPrompt.supportMessages.permissionsReset)
    } catch (error) {
      logger.error('Failed to reset macOS folder permissions', error)
      setSupportError(`Failed to reset permissions: ${error}`)
    } finally {
      setSupportBusy(null)
    }
  }

  if (hasPermission === false) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center z-50"
        style={{ backgroundColor: 'var(--color-overlay-backdrop)' }}
      >
        <div
          className="p-6 rounded-lg shadow-xl max-w-md mx-4"
          style={{ backgroundColor: 'var(--color-surface-modal)' }}
        >
          <h2 className="text-xl font-semibold mb-4 text-white">{t.permissionPrompt.title}</h2>

          <p className="text-gray-300 mb-4">
            {t.permissionPrompt.description}
          </p>
          
          {displayPath && (
            <div className="mb-4 p-2 bg-gray-800 rounded font-mono text-sm text-gray-200">
              {displayPath}
            </div>
          )}
          
          {attemptCount > 0 && (
            <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-600/50 rounded">
              <p className="text-yellow-200 text-sm">
                {attemptCount === 1
                  ? t.permissionPrompt.clickOk
                  : t.permissionPrompt.restartHint}
              </p>
            </div>
          )}
          
          <div className="flex gap-3">
              <button
                onClick={() => { void handleRequestPermission() }}
              disabled={isRetrying}
              className="flex-1 px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors hover:opacity-90"
              style={{ backgroundColor: 'var(--color-accent-cyan)', color: 'var(--color-text-inverse)' }}
            >
              {isRetrying ? t.permissionPrompt.checking : attemptCount === 0 ? t.permissionPrompt.grantPermission : t.permissionPrompt.tryAgain}
            </button>
            
              {attemptCount > 0 && (
                <button
                  onClick={() => { void handleRetryCheck() }}
                disabled={isRetrying}
                className="px-4 py-2 border border-gray-600 text-gray-300 rounded hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {t.permissionPrompt.recheck}
              </button>
            )}
          </div>

          <div
            className="mt-6 p-4 rounded-lg space-y-2"
            style={{
              backgroundColor: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border-subtle)',
            }}
          >
            <h3
              className="text-sm font-semibold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {t.permissionPrompt.troubleTitle}
            </h3>
            <p
              className="text-sm leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {t.permissionPrompt.troubleDesc.replace('{app}', diagnostics?.appDisplayName ?? 'Schaltwerk')}
            </p>
            {installLabel && (
              <p
                className="text-sm"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t.permissionPrompt.detectedInstall.replace('{label}', installLabel)}
              </p>
            )}
            {installGuidance && (
              <p
                className="text-xs leading-relaxed"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {installGuidance}
              </p>
            )}
            {diagnostics && (
              <p
                className="text-xs break-all"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t.permissionPrompt.currentExecutable.replace('{path}', diagnostics.executablePath)}
              </p>
            )}
            {diagnosticsError && (
              <p
                className="text-xs"
                style={{ color: 'var(--color-status-warning)' }}
              >
                {diagnosticsError}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => { void handleOpenSystemSettings() }}
                disabled={supportBusy !== null}
                className="flex-1 px-4 py-2 rounded transition-colors"
                style={{
                  backgroundColor: 'var(--color-accent-blue-bg)',
                  border: '1px solid var(--color-accent-blue-border)',
                  color: 'var(--color-accent-blue)',
                  opacity: supportBusy && supportBusy !== 'open-settings' ? 0.6 : 1,
                }}
              >
                {supportBusy === 'open-settings' ? t.permissionPrompt.opening : t.permissionPrompt.openSystemSettings}
              </button>
              <button
                onClick={() => { void handleResetPermissions() }}
                disabled={supportBusy !== null}
                className="flex-1 px-4 py-2 rounded transition-colors"
                style={{
                  backgroundColor: 'var(--color-accent-violet-bg)',
                  border: '1px solid var(--color-accent-violet-border)',
                  color: 'var(--color-accent-violet)',
                  opacity: supportBusy && supportBusy !== 'reset-permission' ? 0.6 : 1,
                }}
              >
                {supportBusy === 'reset-permission' ? t.permissionPrompt.resetting : t.permissionPrompt.resetFolderAccess}
              </button>
            </div>

            {supportMessage && (
              <p
                className="text-xs leading-relaxed"
                style={{ color: 'var(--color-status-success)' }}
              >
                {supportMessage}
              </p>
            )}
            {supportError && (
              <p
                className="text-xs leading-relaxed"
                style={{ color: 'var(--color-status-error)' }}
              >
                {supportError}
              </p>
            )}
          </div>
          
          {attemptCount > 1 && (
            <>
              <p className="text-gray-400 text-xs mt-4">
                {t.permissionPrompt.persistHint}
              </p>
              {onRetryAgent && hasPermission && (
                <button
                  onClick={() => {
                    onRetryAgent()
                    onPermissionGranted?.()
                  }}
                  className="mt-2 w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                >
                  {t.permissionPrompt.retryAgent}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return null
}
