import type { UnlistenFn } from '@tauri-apps/api/event'
import { logger } from './logger'

type MaybeUnlisten = (() => void | Promise<void>) | UnlistenFn | null | undefined

/**
 * Tear down a Tauri event listener without surfacing cleanup failures.
 *
 * Listener disposal often races with project/session switches where the channel
 * is already closed; rethrowing would trigger unhandled rejections in React.
 * We log the failure at debug so diagnostics are preserved while keeping UI
 * state transitions deterministic.
 */
export async function safeUnlisten(unlisten: MaybeUnlisten, context: string): Promise<void> {
  if (!unlisten) {
    return
  }

  try {
    await unlisten()
  } catch (error) {
    logger.debug(`[safeUnlisten] Failed to clean up listener: ${context}`, error)
  }
}
