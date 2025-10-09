import { listen as tauriListen, emit as tauriEmit, UnlistenFn } from '@tauri-apps/api/event'
import { SchaltEvent, EventPayloadMap } from './events'

const EVENT_NAME_SAFE_PATTERN = /[^a-zA-Z0-9/:_-]/g

function toEventSafeTerminalId(terminalId: string): string {
  return terminalId.replace(EVENT_NAME_SAFE_PATTERN, '_')
}

// Expose helpers so tests and other modules can reuse the exact event channel naming
export function terminalOutputEventName(terminalId: string): string {
  return `terminal-output-${toEventSafeTerminalId(terminalId)}`
}

export function terminalOutputNormalizedEventName(terminalId: string): string {
  return `terminal-output-normalized-${toEventSafeTerminalId(terminalId)}`
}

// Re-export SchaltEvent for convenience
export { SchaltEvent } from './events'

// Type-safe event listening - only accepts SchaltEvent enum values
export async function listenEvent<T extends SchaltEvent>(
  event: T,
  handler: (payload: EventPayloadMap[T]) => void | Promise<void>
): Promise<UnlistenFn> {
  return await tauriListen(event, (event) => handler(event.payload as EventPayloadMap[T]))
}


export async function listenTerminalOutput(
  terminalId: string,
  handler: (payload: string) => void | Promise<void>
): Promise<UnlistenFn> {
  const eventName = terminalOutputEventName(terminalId)
  return await tauriListen(eventName, (event) => handler(event.payload as string))
}

export async function listenTerminalOutputNormalized(
  terminalId: string,
  handler: (payload: string) => void | Promise<void>
): Promise<UnlistenFn> {
  const eventName = terminalOutputNormalizedEventName(terminalId)
  return await tauriListen(eventName, (event) => handler(event.payload as string))
}

export async function emitEvent<T extends SchaltEvent>(
  event: T,
  payload: EventPayloadMap[T]
): Promise<void> {
  return await tauriEmit(event, payload)
}


export async function emitTerminalOutput(
  terminalId: string,
  payload: string
): Promise<void> {
  const eventName = terminalOutputEventName(terminalId)
  return await tauriEmit(eventName, payload)
}

export async function emitTerminalOutputNormalized(
  terminalId: string,
  payload: string
): Promise<void> {
  const eventName = terminalOutputNormalizedEventName(terminalId)
  return await tauriEmit(eventName, payload)
}
