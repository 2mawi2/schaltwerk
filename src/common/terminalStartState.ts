import { logger } from '../utils/logger'
import { clearInflights } from '../utils/singleflight'

export type TerminalStartState = 'starting' | 'started'

const terminalStates = new Map<string, TerminalStartState>()

export function isTerminalStartingOrStarted(terminalId: string): boolean {
  return terminalStates.has(terminalId)
}

export function markTerminalStarting(terminalId: string): void {
  terminalStates.set(terminalId, 'starting')
  logger.debug(`[terminalStartState] ${terminalId} -> starting`)
}

export function markTerminalStarted(terminalId: string): void {
  terminalStates.set(terminalId, 'started')
  logger.debug(`[terminalStartState] ${terminalId} -> started`)
}

export function clearTerminalStartState(terminalIds: string[]): void {
  for (const id of terminalIds) {
    terminalStates.delete(id)
  }
  clearInflights(terminalIds)
  if (terminalIds.length > 0) {
    logger.debug(`[terminalStartState] cleared: ${terminalIds.join(', ')}`)
  }
}

export function clearTerminalStartStateByPrefix(prefix: string): void {
  const toDelete: string[] = []
  for (const id of terminalStates.keys()) {
    if (id.startsWith(prefix)) {
      toDelete.push(id)
    }
  }
  clearTerminalStartState(toDelete)
}
