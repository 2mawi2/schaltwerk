import { useEffect, useState, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useFolderPermission } from '../hooks/usePermissions'
import { theme } from '../common/theme'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from '../utils/logger'

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
        return 'Standard macOS app bundle'
      case 'homebrew':
        return 'Homebrew installation'
      case 'justfile':
        return 'Development build (just run)'
      case 'standalone':
        return 'Direct binary execution'
      default:
        return 'Custom installation'
    }
  }, [diagnostics])

  const installGuidance = useMemo(() => {
    if (!diagnostics) {
      return null
    }

    switch (diagnostics.installKind) {
      case 'app-bundle':
        return 'Look for "Schaltwerk" in Files and Folders and enable Documents access.'
      case 'homebrew':
        return 'Look for the Schaltwerk entry added by Homebrew under Files and Folders.'
      case 'justfile':
        return 'macOS lists the development binary path below - enable Documents access for that entry.'
      case 'standalone':
        return 'If System Settings shows a direct binary path, enable Documents access for that entry.'
      default:
        return 'Enable Documents access for the matching entry shown in Files and Folders.'
    }
  }, [diagnostics])

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
      setTimeout(async () => {
        const recheckGranted = await checkPermission(pathToRequest)
        if (recheckGranted && onPermissionGranted) {
          onPermissionGranted()
        }
        setIsRetrying(false)
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
      setSupportMessage('System Settings opened. Enable Documents access, then return here and click Try Again.')
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
      setSupportMessage('Folder permissions were reset. macOS will prompt for access again the next time you try.')
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
        style={{ backgroundColor: theme.colors.overlay.backdrop }}
      >
        <div
          className="p-6 rounded-lg shadow-xl max-w-md mx-4"
          style={{ backgroundColor: theme.colors.surface.modal }}
        >
          <h2 className="text-xl font-semibold mb-4 text-white">Folder Access Required</h2>
          
          <p className="text-gray-300 mb-4">
            Schaltwerk needs access to the following folder to manage development sessions and run AI agents:
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
                  ? "Please click 'OK' in the system permission dialog that appeared."
                  : "If you granted permission, you may need to restart the agent for it to take effect."}
              </p>
            </div>
          )}
          
          <div className="flex gap-3">
            <button
              onClick={handleRequestPermission}
              disabled={isRetrying}
              className="flex-1 px-4 py-2 bg-cyan-600 text-white rounded hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRetrying ? 'Checking...' : attemptCount === 0 ? 'Grant Permission' : 'Try Again'}
            </button>
            
            {attemptCount > 0 && (
              <button
                onClick={handleRetryCheck}
                disabled={isRetrying}
                className="px-4 py-2 border border-gray-600 text-gray-300 rounded hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Recheck
              </button>
            )}
          </div>

          <div
            className="mt-6 p-4 rounded-lg space-y-2"
            style={{
              backgroundColor: theme.colors.background.elevated,
              border: `1px solid ${theme.colors.border.subtle}`,
            }}
          >
            <h3
              className="text-sm font-semibold"
              style={{ color: theme.colors.text.primary }}
            >
              Having trouble granting access?
            </h3>
            <p
              className="text-sm leading-relaxed"
              style={{ color: theme.colors.text.secondary }}
            >
              Enable Documents access for {diagnostics?.appDisplayName ?? 'Schaltwerk'} in System Settings &gt; Privacy &amp; Security &gt; Files and Folders, then return here and click Try Again.
            </p>
            {installLabel && (
              <p
                className="text-sm"
                style={{ color: theme.colors.text.secondary }}
              >
                Detected install: {installLabel}
              </p>
            )}
            {installGuidance && (
              <p
                className="text-xs leading-relaxed"
                style={{ color: theme.colors.text.muted }}
              >
                {installGuidance}
              </p>
            )}
            {diagnostics && (
              <p
                className="text-xs break-all"
                style={{ color: theme.colors.text.muted }}
              >
                Current executable: {diagnostics.executablePath}
              </p>
            )}
            {diagnosticsError && (
              <p
                className="text-xs"
                style={{ color: theme.colors.status.warning }}
              >
                {diagnosticsError}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={handleOpenSystemSettings}
                disabled={supportBusy !== null}
                className="flex-1 px-4 py-2 rounded transition-colors"
                style={{
                  backgroundColor: theme.colors.accent.blue.bg,
                  border: `1px solid ${theme.colors.accent.blue.border}`,
                  color: theme.colors.accent.blue.DEFAULT,
                  opacity: supportBusy && supportBusy !== 'open-settings' ? 0.6 : 1,
                }}
              >
                {supportBusy === 'open-settings' ? 'Opening...' : 'Open System Settings'}
              </button>
              <button
                onClick={handleResetPermissions}
                disabled={supportBusy !== null}
                className="flex-1 px-4 py-2 rounded transition-colors"
                style={{
                  backgroundColor: theme.colors.accent.violet.bg,
                  border: `1px solid ${theme.colors.accent.violet.border}`,
                  color: theme.colors.accent.violet.DEFAULT,
                  opacity: supportBusy && supportBusy !== 'reset-permission' ? 0.6 : 1,
                }}
              >
                {supportBusy === 'reset-permission' ? 'Resetting...' : 'Reset Folder Access'}
              </button>
            </div>

            {supportMessage && (
              <p
                className="text-xs leading-relaxed"
                style={{ color: theme.colors.status.success }}
              >
                {supportMessage}
              </p>
            )}
            {supportError && (
              <p
                className="text-xs leading-relaxed"
                style={{ color: theme.colors.status.error }}
              >
                {supportError}
              </p>
            )}
          </div>
          
          {attemptCount > 1 && (
            <>
              <p className="text-gray-400 text-xs mt-4">
                If issues persist, try restarting Schaltwerk after granting permission.
              </p>
              {onRetryAgent && hasPermission && (
                <button
                  onClick={() => {
                    onRetryAgent()
                    onPermissionGranted?.()
                  }}
                  className="mt-2 w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                >
                  Retry Starting Agent
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
