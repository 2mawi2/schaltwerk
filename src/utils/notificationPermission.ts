import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { logger } from './logger'

let hasLoggedUnavailable = false

const logUnavailableOnce = (error?: unknown) => {
  if (hasLoggedUnavailable) return
  hasLoggedUnavailable = true
  logger.debug(
    '[notificationPermission] Notification permission unavailable; treating as not granted',
    error
  )
}

export const resetNotificationPermissionDebugFlag = () => {
  hasLoggedUnavailable = false
}

export async function isNotificationPermissionGranted(): Promise<boolean> {
  try {
    const granted = await isPermissionGranted()
    if (!granted) {
      logUnavailableOnce()
    }
    return granted
  } catch (error) {
    logUnavailableOnce(error)
    return false
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const result = await requestPermission()
    const granted = result === 'granted'
    if (!granted) {
      logUnavailableOnce()
    }
    return granted
  } catch (error) {
    logUnavailableOnce(error)
    return false
  }
}
