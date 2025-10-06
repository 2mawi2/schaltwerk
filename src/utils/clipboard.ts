import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from './logger'

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await invoke(TauriCommands.ClipboardWriteText, { text })
    return true
  } catch (err) {
    logger.warn('[clipboard] Native clipboard write failed, falling back to browser API', err)
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (browserErr) {
      logger.error('[clipboard] Browser clipboard write failed', browserErr)
      return false
    }
  }

  return false
}
