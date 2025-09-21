export enum UiEvent {
  PermissionError = 'schaltwerk:permission-error',
  BackgroundStartMarked = 'schaltwerk:terminal-background-started',
}

export type UiEventPayloads = {
  [UiEvent.PermissionError]: { error: string }
  [UiEvent.BackgroundStartMarked]: { terminalId: string }
}

export function emitUiEvent<T extends UiEvent>(event: T, detail: UiEventPayloads[T]): void {
  window.dispatchEvent(new CustomEvent(String(event), { detail }))
}

export function listenUiEvent<T extends UiEvent>(
  event: T,
  handler: (detail: UiEventPayloads[T]) => void
): () => void {
  const listener = ((e: Event) => {
    const detail = (e as CustomEvent<UiEventPayloads[T]>).detail
    handler(detail)
  }) as EventListener
  window.addEventListener(String(event), listener)
  return () => window.removeEventListener(String(event), listener)
}

// Deterministic, process-wide registry to record terminals that were background-started
// before their UI mounted. This avoids duplicate auto-starts.
const bgStarted = new Set<string>()  // terminalId strings, e.g., "session-foo-top"

export function markBackgroundStart(terminalId: string) {
  bgStarted.add(terminalId)
  emitUiEvent(UiEvent.BackgroundStartMarked, { terminalId })
}

export function hasBackgroundStart(terminalId: string): boolean {
  return bgStarted.has(terminalId)
}

export function clearBackgroundStarts(ids: string[]): void {
  for (const id of ids) bgStarted.delete(id)
}

/**
 * Mark a terminal as background-started while executing the provided async fn.
 * If fn throws, roll back the mark to allow another component to retry.
 */
export async function withBackgroundStart<T>(terminalId: string, fn: () => Promise<T>): Promise<T> {
  markBackgroundStart(terminalId)
  try {
    return await fn()
  } catch (e) {
    // Roll back on failure so other paths may start the agent (or user can retry)
    clearBackgroundStarts([terminalId])
    throw e
  }
}

/**
 * Clear any marks that match a prefix. Useful on project close for orchestrator terminals.
 * Example: clearBackgroundStartsByPrefix(`orchestrator-${projectId}`)
 */
export function clearBackgroundStartsByPrefix(prefix: string): void {
  const toDelete: string[] = []
  for (const id of bgStarted) {
    if (id.startsWith(prefix)) toDelete.push(id)
  }
  clearBackgroundStarts(toDelete)
}

/** @internal test/debug only */
export function __debug_getBackgroundStartIds(): string[] {
  return Array.from(bgStarted)
}