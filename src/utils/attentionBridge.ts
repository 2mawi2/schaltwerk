import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from './logger'

type NotificationPluginModule = typeof import('@tauri-apps/plugin-notification')

let notificationPluginPromise: Promise<NotificationPluginModule | null> | null = null

async function loadNotificationPlugin(): Promise<NotificationPluginModule | null> {
  if (!notificationPluginPromise) {
    notificationPluginPromise = import('@tauri-apps/plugin-notification')
      .catch((error) => {
        logger.debug('[attentionBridge] Notification plugin unavailable:', error)
        return null
      })
  }
  return notificationPluginPromise
}

export interface AttentionSnapshotResponse {
  totalCount: number
  badgeLabel: string | null
}

const WINDOW_LABEL_FALLBACK = 'main'

export async function getCurrentWindowLabel(): Promise<string> {
  try {
    const window = await getCurrentWindow()
    return window.label ?? WINDOW_LABEL_FALLBACK
  } catch (error) {
    logger.debug('[attentionBridge] Failed to resolve current window label:', error)
    return WINDOW_LABEL_FALLBACK
  }
}

export async function requestDockBounce(): Promise<void> {
  try {
    const window = await getCurrentWindow()
    await window.requestUserAttention(UserAttentionType.Informational)
  } catch (error) {
    logger.debug('[attentionBridge] requestUserAttention failed:', error)
  }
}

export async function reportAttentionSnapshot(windowLabel: string, sessionKeys: string[]): Promise<AttentionSnapshotResponse> {
  try {
    const response = await invoke<AttentionSnapshotResponse>(TauriCommands.ReportAttentionSnapshot, {
      windowLabel,
      sessionKeys,
    })
    return {
      totalCount: response?.totalCount ?? 0,
      badgeLabel: response?.badgeLabel ?? null,
    }
  } catch (error) {
    logger.debug('[attentionBridge] Failed to report attention snapshot:', error)
    return { totalCount: 0, badgeLabel: null }
  }
}

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  const plugin = await loadNotificationPlugin()
  if (plugin) {
    try {
      if (await plugin.isPermissionGranted()) {
        return 'granted'
      }
      const permission = await plugin.requestPermission()
      return permission === 'granted' ? 'granted' : 'denied'
    } catch (error) {
      logger.debug('[attentionBridge] Plugin notification permission request failed:', error)
    }
  }

  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'denied'
  }

  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }

  try {
    const permission = await Notification.requestPermission()
    return permission
  } catch (error) {
    logger.debug('[attentionBridge] Notification permission request failed:', error)
    return 'denied'
  }
}

export interface SystemNotificationOptions {
  title: string
  body: string
  silent?: boolean
}

export async function showSystemNotification(options: SystemNotificationOptions): Promise<boolean> {
  const plugin = await loadNotificationPlugin()
  if (plugin) {
    try {
      const granted = await plugin.isPermissionGranted()
      if (!granted) {
        const permission = await plugin.requestPermission()
        if (permission !== 'granted') {
          return false
        }
      }

      await plugin.sendNotification({
        title: options.title,
        body: options.body,
        silent: options.silent ?? false,
      })
      return true
    } catch (error) {
      logger.debug('[attentionBridge] Failed to display notification via plugin:', error)
    }
  }

  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return false
  }

  const permission = await ensureNotificationPermission()
  if (permission !== 'granted') {
    return false
  }

  try {
    new Notification(options.title, {
      body: options.body,
      silent: options.silent ?? false,
    })
    return true
  } catch (error) {
    logger.debug('[attentionBridge] Failed to display system notification:', error)
    return false
  }
}
