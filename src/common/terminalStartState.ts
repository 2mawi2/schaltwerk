import { logger } from '../utils/logger'
import { clearInflights } from '../utils/singleflight'
import { scopedTerminalKey } from './scopeKeys'

export type TerminalStartState = 'starting' | 'started'

const terminalStates = new Map<string, TerminalStartState>()

function terminalStartKey(terminalId: string, projectPath?: string | null): string {
  if (projectPath === undefined) {
    return terminalId
  }
  return scopedTerminalKey(projectPath, terminalId)
}

export function isTerminalStartingOrStarted(terminalId: string, projectPath?: string | null): boolean {
  return terminalStates.has(terminalStartKey(terminalId, projectPath))
}

export function markTerminalStarting(terminalId: string, projectPath?: string | null): void {
  const key = terminalStartKey(terminalId, projectPath)
  terminalStates.set(key, 'starting')
  logger.debug(`[terminalStartState] ${key} -> starting`)
}

export function markTerminalStarted(terminalId: string, projectPath?: string | null): void {
  const key = terminalStartKey(terminalId, projectPath)
  terminalStates.set(key, 'started')
  logger.debug(`[terminalStartState] ${key} -> started`)
}

export function clearTerminalStartState(terminalIds: string[], projectPath?: string | null): void {
  const scopedIds = terminalIds.map(id => terminalStartKey(id, projectPath))
  for (const id of terminalIds) {
    terminalStates.delete(terminalStartKey(id, projectPath))
  }
  clearInflights(scopedIds)
  if (terminalIds.length > 0) {
    logger.debug(`[terminalStartState] cleared: ${scopedIds.join(', ')}`)
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
