import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { bestBootstrapSize } from './terminalSizeCache'
import { markBackgroundStart, clearBackgroundStarts, emitUiEvent, UiEvent } from './uiEvents'
import { singleflight, hasInflight } from '../utils/singleflight'
import { logger } from '../utils/logger'
import {
  recordAgentLifecycle,
  shouldUseExtendedAgentTimeout,
  EXTENDED_AGENT_START_TIMEOUT_MS,
  DEFAULT_AGENT_START_TIMEOUT_MS,
} from './agentLifecycleTracker'

export { EXTENDED_AGENT_START_TIMEOUT_MS, DEFAULT_AGENT_START_TIMEOUT_MS } from './agentLifecycleTracker'

export const RIGHT_EDGE_GUARD_COLUMNS = 2
export const AGENT_START_TIMEOUT_MESSAGE = 'Agent start timed out before the agent was ready.'

let agentStartTimeoutMetric = 0

export function getAgentStartTimeoutMetricForTests(): number {
  return agentStartTimeoutMetric
}

export function resetAgentStartTimeoutMetricForTests(): void {
  agentStartTimeoutMetric = 0
}

function determineStartTimeoutMs(agentType?: string | null): number {
  return shouldUseExtendedAgentTimeout(agentType) ? EXTENDED_AGENT_START_TIMEOUT_MS : DEFAULT_AGENT_START_TIMEOUT_MS
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function withAgentStartTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  context: { id: string; command: string }
) {
  let settled = false
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  return new Promise<T>((resolve, reject) => {
    const clearTimer = () => {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
    }

    timeoutHandle = setTimeout(() => {
      if (settled) return
      settled = true
      clearTimer()
      agentStartTimeoutMetric += 1
      logger.warn(
        `[agentSpawn] start timed out for ${context.id} (${context.command}) after ${timeoutMs}ms; total_timeouts=${agentStartTimeoutMetric}`
      )
      reject(new Error(AGENT_START_TIMEOUT_MESSAGE))
    }, timeoutMs)

    promise.then(value => {
      if (settled) {
        logger.warn(`[agentSpawn] ${context.command} resolved after timeout for ${context.id}`)
        return
      }
      settled = true
      clearTimer()
      resolve(value)
    }).catch(error => {
      if (settled) {
        logger.warn(`[agentSpawn] ${context.command} rejected after timeout for ${context.id}:`, error)
        return
      }
      settled = true
      clearTimer()
      reject(error)
    })
  })
}

export function computeProjectOrchestratorId(projectPath?: string | null): string | null {
  if (!projectPath) return null
  const dirName = projectPath.split(/[/\\]/).pop() || 'unknown'
  const sanitizedDirName = dirName.replace(/[^a-zA-Z0-9_-]/g, '_')
  let hash = 0
  for (let i = 0; i < projectPath.length; i++) {
    hash = ((hash << 5) - hash) + projectPath.charCodeAt(i)
    hash |= 0
  }
  const projectId = `${sanitizedDirName}-${Math.abs(hash).toString(16).slice(0, 6)}`
  return `orchestrator-${projectId}-top`
}

export function computeSpawnSize(opts: {
  topId: string
  measured?: { cols?: number | null; rows?: number | null }
  projectOrchestratorId?: string | null
}) {
  const { topId, measured, projectOrchestratorId } = opts
  const MIN = 2

  if (measured?.cols && measured?.rows) {
    return {
      cols: Math.max(MIN, measured.cols - RIGHT_EDGE_GUARD_COLUMNS),
      rows: measured.rows
    }
  }
  const boot = bestBootstrapSize({ topId, projectOrchestratorId: projectOrchestratorId ?? undefined })
  return {
    cols: Math.max(MIN, boot.cols - RIGHT_EDGE_GUARD_COLUMNS),
    rows: boot.rows
  }
}

export async function startSessionTop(params: {
  sessionName: string
  topId: string
  projectOrchestratorId?: string | null
  measured?: { cols?: number | null; rows?: number | null }
  agentType?: string
}) {
  const { sessionName, topId, projectOrchestratorId, measured } = params
  const agentType = params.agentType ?? 'claude'

  if (agentType === 'terminal') {
    logger.info(`[agentSpawn] Skipping agent startup for terminal-only session: ${sessionName}`)
    return
  }

  if (hasInflight(topId)) return
  markBackgroundStart(topId)
  try {
    const { cols, rows } = computeSpawnSize({ topId, measured, projectOrchestratorId })
    const timeoutMs = determineStartTimeoutMs(agentType)
    const command = TauriCommands.SchaltwerkCoreStartSessionAgent

    await singleflight(topId, async () => {
      const lifecycleBase = {
        terminalId: topId,
        sessionName,
        agentType,
      }
      const startPromise = invoke(command, { sessionName, cols, rows })
      const spawnedAt = Date.now()
      recordAgentLifecycle({ ...lifecycleBase, state: 'spawned', whenMs: spawnedAt })
      emitUiEvent(UiEvent.AgentLifecycle, { ...lifecycleBase, state: 'spawned', occurredAtMs: spawnedAt })

      try {
        await withAgentStartTimeout(
          startPromise,
          timeoutMs,
          { id: topId, command }
        )
        const readyAt = Date.now()
        recordAgentLifecycle({ ...lifecycleBase, state: 'ready', whenMs: readyAt })
        emitUiEvent(UiEvent.AgentLifecycle, { ...lifecycleBase, state: 'ready', occurredAtMs: readyAt })
      } catch (error) {
        const failedAt = Date.now()
        const message = getErrorMessage(error)
        recordAgentLifecycle({ ...lifecycleBase, state: 'failed', whenMs: failedAt, reason: message })
        emitUiEvent(UiEvent.AgentLifecycle, {
          ...lifecycleBase,
          state: 'failed',
          occurredAtMs: failedAt,
          reason: message,
        })
        throw error
      }
    })
  } catch (e) {
    try {
      clearBackgroundStarts([topId])
    } catch (_cleanupErr) {
      // Ignore cleanup failures during error handling
    }
    throw e
  }
}

export async function startOrchestratorTop(params: {
  terminalId: string
  measured?: { cols?: number | null; rows?: number | null }
}) {
  const { terminalId, measured } = params
  if (hasInflight(terminalId)) return
  markBackgroundStart(terminalId)
  try {
    const { cols, rows } = computeSpawnSize({ topId: terminalId, measured })
    const agentType = 'claude'
    const timeoutMs = determineStartTimeoutMs(agentType)
    await singleflight(terminalId, async () => {
      const lifecycleBase = { terminalId, agentType }
      const startPromise = invoke(TauriCommands.SchaltwerkCoreStartClaudeOrchestrator, { terminalId, cols, rows })
      const spawnedAt = Date.now()
      recordAgentLifecycle({ ...lifecycleBase, state: 'spawned', whenMs: spawnedAt })
      emitUiEvent(UiEvent.AgentLifecycle, { ...lifecycleBase, state: 'spawned', occurredAtMs: spawnedAt })

      try {
        await withAgentStartTimeout(
          startPromise,
          timeoutMs,
          { id: terminalId, command: TauriCommands.SchaltwerkCoreStartClaudeOrchestrator }
        )
        const readyAt = Date.now()
        recordAgentLifecycle({ ...lifecycleBase, state: 'ready', whenMs: readyAt })
        emitUiEvent(UiEvent.AgentLifecycle, { ...lifecycleBase, state: 'ready', occurredAtMs: readyAt })
      } catch (error) {
        const failedAt = Date.now()
        const message = getErrorMessage(error)
        recordAgentLifecycle({ ...lifecycleBase, state: 'failed', whenMs: failedAt, reason: message })
        emitUiEvent(UiEvent.AgentLifecycle, {
          ...lifecycleBase,
          state: 'failed',
          occurredAtMs: failedAt,
          reason: message,
        })
        throw error
      }
    })
  } catch (e) {
    try {
      clearBackgroundStarts([terminalId])
    } catch (_cleanupErr) {
      // Ignore cleanup failures during error handling
    }
    throw e
  }
}
