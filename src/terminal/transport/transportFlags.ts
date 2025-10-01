import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { PluginTransport } from './PluginTransport'
import { logger } from '../../utils/logger'

let cached: boolean | null = null
let pluginInstance: PluginTransport | null = null

export async function shouldUsePluginTransport(): Promise<boolean> {
  if (cached !== null) {
    return cached
  }

  // First check runtime environment (useful for tests and SSR)
  if (typeof process !== 'undefined' && process?.env?.SCHALTWERK_TERMINAL_TRANSPORT === 'pty_plugin') {
    cached = true
    return true
  }

  if (typeof window !== 'undefined' && !(window as unknown as { __TAURI_IPC__?: unknown }).__TAURI_IPC__) {
    cached = false
    return false
  }

  try {
    const value = await invoke<string | null>(TauriCommands.GetEnvironmentVariable, {
      name: 'SCHALTWERK_TERMINAL_TRANSPORT',
    })
    cached = value === 'pty_plugin'
  } catch (error) {
    logger.debug('[Terminal] Failed to resolve terminal transport preference', error)
    cached = false
  }

  return cached
}

export async function getPluginTransport(): Promise<PluginTransport | null> {
  if (!(await shouldUsePluginTransport())) {
    return null
  }
  if (!pluginInstance) {
    pluginInstance = new PluginTransport()
  }
  return pluginInstance
}
