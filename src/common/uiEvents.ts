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
const bgStarted = new Set<string>()

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
