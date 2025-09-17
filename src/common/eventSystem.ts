import { listen as tauriListen, emit as tauriEmit, UnlistenFn } from '@tauri-apps/api/event'
import { SchaltEvent, EventPayloadMap } from './events'

// Terminal output events are not enum-based, they use dynamic terminal IDs
function createTerminalOutputEvent(terminalId: string): string {
  return `terminal-output-${terminalId}`
}

function createTerminalOutputNormalizedEvent(terminalId: string): string {
  return `terminal-output-normalized-${terminalId}`
}

// Re-export SchaltEvent for convenience
export { SchaltEvent } from './events'

export interface TerminalOutputEventPayload {
  seq: number
  data: string
}

// Type-safe event listening - only accepts SchaltEvent enum values
export async function listenEvent<T extends SchaltEvent>(
  event: T,
  handler: (payload: EventPayloadMap[T]) => void | Promise<void>
): Promise<UnlistenFn> {
  return await tauriListen(event, (event) => handler(event.payload as EventPayloadMap[T]))
}


export async function listenTerminalOutput(
  terminalId: string,
  handler: (payload: TerminalOutputEventPayload | string) => void | Promise<void>
): Promise<UnlistenFn> {
  const eventName = createTerminalOutputEvent(terminalId)
  return await tauriListen(eventName, (event) => handler(event.payload as TerminalOutputEventPayload | string))
}

export async function listenTerminalOutputNormalized(
  terminalId: string,
  handler: (payload: string) => void | Promise<void>
): Promise<UnlistenFn> {
  const eventName = createTerminalOutputNormalizedEvent(terminalId)
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
  payload: TerminalOutputEventPayload | string
): Promise<void> {
  const eventName = createTerminalOutputEvent(terminalId)
  return await tauriEmit(eventName, payload)
}

export async function emitTerminalOutputNormalized(
  terminalId: string,
  payload: string
): Promise<void> {
  const eventName = createTerminalOutputNormalizedEvent(terminalId)
  return await tauriEmit(eventName, payload)
}
