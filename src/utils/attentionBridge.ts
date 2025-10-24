import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from './logger'

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
