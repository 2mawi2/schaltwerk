import { UiEvent, emitUiEvent } from '../common/uiEvents'

const REFINE_PREFIX = 'Refine spec: '

export function buildSpecRefineReference(sessionId: string, displayName?: string | null): string {
  const name = displayName && displayName.trim().length > 0 ? displayName.trim() : sessionId
  return `${REFINE_PREFIX}${name} (${sessionId})`
}

export function emitSpecRefine(sessionId: string, displayName?: string | null): string {
  const text = buildSpecRefineReference(sessionId, displayName)
  emitUiEvent(UiEvent.OpenSpecInOrchestrator, { sessionName: sessionId })
  emitUiEvent(UiEvent.InsertTerminalText, { text })
  return text
}
