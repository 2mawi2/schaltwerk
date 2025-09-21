import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { bestBootstrapSize } from './terminalSizeCache'
import { markBackgroundStart, clearBackgroundStarts } from './uiEvents'
import { singleflight, hasInflight } from '../utils/singleflight'

export const RIGHT_EDGE_GUARD_COLUMNS = 2

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
}) {
  const { sessionName, topId, projectOrchestratorId, measured } = params
  if (hasInflight(topId)) return
  markBackgroundStart(topId)
  try {
    const { cols, rows } = computeSpawnSize({ topId, measured, projectOrchestratorId })
    await singleflight(topId, () =>
      invoke(TauriCommands.SchaltwerkCoreStartClaude, { sessionName, cols, rows })
    )
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
    await singleflight(terminalId, () =>
      invoke(TauriCommands.SchaltwerkCoreStartClaudeOrchestrator, { terminalId, cols, rows })
    )
  } catch (e) {
    try {
      clearBackgroundStarts([terminalId])
    } catch (_cleanupErr) {
      // Ignore cleanup failures during error handling
    }
    throw e
  }
}