import { UiEvent, emitUiEvent } from '../common/uiEvents'
import { logger } from './logger'

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

interface RefineWithOrchestratorOptions {
  sessionId: string
  displayName?: string | null
  selectOrchestrator: () => Promise<void>
  logContext?: string
}

export async function runSpecRefineWithOrchestrator({
  sessionId,
  displayName,
  selectOrchestrator,
  logContext = '[specRefine]',
}: RefineWithOrchestratorOptions): Promise<void> {
  try {
    await selectOrchestrator()
  } catch (error) {
    logger.warn(`${logContext} Failed to switch to orchestrator for refine`, error)
  } finally {
    emitSpecRefine(sessionId, displayName)
  }
}
