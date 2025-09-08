import type { Selection } from '../contexts/SelectionContext'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from '../utils/logger'

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

// Returns the best path for the Open button: prefer active session worktree if running
export async function resolveOpenPathForOpenButton(params: {
  selection: Selection
  activeTabPath: string | null
  projectPath: string | null
  invoke: InvokeFn
}): Promise<string | undefined> {
  const { selection, activeTabPath, projectPath, invoke } = params

  // Prefer currently selected running session worktree
  try {
    if (selection.kind === 'session' && selection.payload) {
      if (selection.worktreePath && selection.sessionState !== 'spec') {
        return selection.worktreePath
      }
      try {
        const sessionData = await invoke<any>(TauriCommands.SchaltwerkCoreGetSession, { name: selection.payload })
        const state: string | undefined = sessionData?.session_state
        const worktreePath: string | undefined = sessionData?.worktree_path
        if (state && state !== 'spec' && worktreePath) {
          return worktreePath
        }
      } catch (e) {
        logger.warn('[resolveOpenPath] Failed to fetch session; falling back to project path:', e)
      }
    }
  } catch (e) {
    logger.warn('[resolveOpenPath] Unexpected error resolving open path, using fallback:', e)
  }

  // Fallback to active tab or project root
  return activeTabPath || projectPath || undefined
}
