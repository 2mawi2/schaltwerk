import { listenEvent, SchaltEvent } from '../common/eventSystem'

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
    unlisten()
  }
}
