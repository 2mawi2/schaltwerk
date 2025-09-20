import { useEffect, useState, useMemo } from 'react'
import { useFolderPermission } from '../hooks/usePermissions'
import { theme } from '../common/theme'

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
    
    setIsRetrying(true)
    const pathToCheck = deniedPath || folderPath || ''
    const granted = await checkPermission(pathToCheck)
    if (granted && onPermissionGranted) {
      onPermissionGranted()
    }
    setIsRetrying(false)
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
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
