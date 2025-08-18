import { useEffect, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

export function useFolderPermission(folderPath?: string) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [deniedPath, setDeniedPath] = useState<string | null>(null)

  const checkPermission = useCallback(async (path: string) => {
    setIsChecking(true)
    setPermissionError(null)
    
    try {
      const hasAccess = await invoke<boolean>('check_folder_access', { path })
      setHasPermission(hasAccess)
      if (!hasAccess) {
        setDeniedPath(path)
      }
      return hasAccess
    } catch (error) {
      console.error(`Error checking folder permission for ${path}:`, error)
      setPermissionError(String(error))
      setHasPermission(false)
      setDeniedPath(path)
      return false
    } finally {
      setIsChecking(false)
    }
  }, [])

  const requestPermission = useCallback(async (path: string) => {
    setIsChecking(true)
    setPermissionError(null)
    
    try {
      await invoke('ensure_folder_permission', { path })
      
      await new Promise(resolve => setTimeout(resolve, 500))
      
      const hasAccess = await checkPermission(path)
      
      if (!hasAccess) {
        console.log(`Permission dialog was shown but access not granted yet for ${path}. User may need to grant permission and restart the agent.`)
      }
      
      return hasAccess
    } catch (error) {
      console.error(`Error requesting folder permission for ${path}:`, error)
      setPermissionError(String(error))
      return false
    } finally {
      setIsChecking(false)
    }
  }, [checkPermission])

  useEffect(() => {
    if (folderPath) {
      checkPermission(folderPath)
    }
  }, [folderPath, checkPermission])

  return {
    hasPermission,
    isChecking,
    permissionError,
    deniedPath,
    checkPermission,
    requestPermission
  }
}