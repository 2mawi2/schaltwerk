import { listen as tauriListen, UnlistenFn } from '@tauri-apps/api/event'
import { SchaltEvent, EventPayloadMap } from './events'
import { logger } from '../utils/logger'

const EVENT_NAME_SAFE_PATTERN = /[^a-zA-Z0-9/:_-]/g

function toEventSafeTerminalId(terminalId: string): string {
  return terminalId.replace(EVENT_NAME_SAFE_PATTERN, '_')
}

function wrapUnlisten(unlisten: UnlistenFn, label: string): UnlistenFn {
  return () => {
    try {
      const result = unlisten()
      void Promise.resolve(result).catch(error => {
        logger.warn(`[eventSystem] Failed to unlisten ${label}`, error)
      })
    } catch (error) {
      logger.warn(`[eventSystem] Failed to unlisten ${label}`, error)
    }
  }
}

// Expose helpers so tests and other modules can reuse the exact event channel naming
export function terminalOutputEventName(terminalId: string): string {
  return `terminal-output-${toEventSafeTerminalId(terminalId)}`
}

// Re-export SchaltEvent for convenience
export { SchaltEvent } from './events'

// Type-safe event listening - only accepts SchaltEvent enum values
export async function listenEvent<T extends SchaltEvent>(
  event: T,
  handler: (payload: EventPayloadMap[T]) => void | Promise<void>
): Promise<UnlistenFn> {
  const unlisten = await tauriListen(event, (event) => {
    void handler(event.payload as EventPayloadMap[T])
  })
  return wrapUnlisten(unlisten, String(event))
}


export async function listenTerminalOutput(
  terminalId: string,
  handler: (payload: string) => void | Promise<void>
): Promise<UnlistenFn> {
  const eventName = terminalOutputEventName(terminalId)
  const unlisten = await tauriListen(eventName, (event) => {
    void handler(event.payload as string)
  })
  return wrapUnlisten(unlisten, eventName)
}
