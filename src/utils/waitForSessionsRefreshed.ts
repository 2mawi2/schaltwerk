import { listenEvent, SchaltEvent } from '../common/eventSystem'
import { safeUnlisten } from './safeUnlisten'

export async function waitForSessionsRefreshed<T>(
  action: () => Promise<T> | T
): Promise<T> {
  let resolveEvent: (() => void) | null = null

  const waitForEvent = new Promise<void>((resolve) => {
    resolveEvent = resolve
  })

  const unlisten = await listenEvent(SchaltEvent.SessionsRefreshed, () => {
    resolveEvent?.()
  })

  try {
    const result = await action()
    await waitForEvent
    return result
  } finally {
    await safeUnlisten(unlisten, '[waitForSessionsRefreshed] SessionsRefreshed listener')
  }
}
