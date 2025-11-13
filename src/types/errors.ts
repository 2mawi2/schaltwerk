export type SchaltError =
  | { type: 'SessionNotFound'; data: { session_id: string } }
  | { type: 'SessionAlreadyExists'; data: { session_id: string } }
  | { type: 'WorktreeNotFound'; data: { path: string } }
  | { type: 'WorktreeAlreadyExists'; data: { path: string } }
  | { type: 'GitOperationFailed'; data: { operation: string; message: string } }
  | { type: 'DatabaseError'; data: { message: string } }
  | { type: 'InvalidInput'; data: { field: string; message: string } }
  | { type: 'TerminalNotFound'; data: { terminal_id: string } }
  | {
      type: 'TerminalOperationFailed'
      data: { terminal_id: string; operation: string; message: string }
    }
  | { type: 'ProjectNotFound'; data: { project_path: string } }
  | { type: 'IoError'; data: { operation: string; path: string; message: string } }
  | { type: 'MergeConflict'; data: { files: string[]; message: string } }
  | {
      type: 'InvalidSessionState'
      data: { session_id: string; current_state: string; expected_state: string }
    }
  | { type: 'AgentNotFound'; data: { agent_name: string } }
  | { type: 'ConfigError'; data: { key: string; message: string } }

export function isSchaltError(error: unknown): error is SchaltError {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const candidate = error as Record<string, unknown>
  return typeof candidate.type === 'string' && 'data' in candidate
}

export function getErrorMessage(error: unknown): string {
  if (isSchaltError(error)) {
    switch (error.type) {
      case 'SessionNotFound':
        return `Session '${error.data.session_id}' not found`
      case 'SessionAlreadyExists':
        return `Session '${error.data.session_id}' already exists`
      case 'WorktreeNotFound':
        return `Worktree not found at path: ${error.data.path}`
      case 'WorktreeAlreadyExists':
        return `Worktree already exists at path: ${error.data.path}`
      case 'GitOperationFailed':
        return `Git operation '${error.data.operation}' failed: ${error.data.message}`
      case 'DatabaseError':
        return `Database error: ${error.data.message}`
      case 'InvalidInput':
        return `Invalid input for field '${error.data.field}': ${error.data.message}`
      case 'TerminalNotFound':
        return `Terminal '${error.data.terminal_id}' not found`
      case 'TerminalOperationFailed':
        return `Terminal operation '${error.data.operation}' failed for terminal '${error.data.terminal_id}': ${error.data.message}`
      case 'ProjectNotFound':
        return `Project not found at path: ${error.data.project_path}`
      case 'IoError':
        return `I/O error during '${error.data.operation}' on '${error.data.path}': ${error.data.message}`
      case 'MergeConflict':
        return `Merge conflict in ${error.data.files.length} file(s): ${error.data.message}`
      case 'InvalidSessionState':
        return `Session '${error.data.session_id}' is in state '${error.data.current_state}', expected '${error.data.expected_state}'`
      case 'AgentNotFound':
        return `Agent '${error.data.agent_name}' not found`
      case 'ConfigError':
        return `Configuration error for key '${error.data.key}': ${error.data.message}`
      default: {
        const _exhaustive: never = error
        return `Unknown error: ${_exhaustive}`
      }
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'An unknown error occurred'
}

export function isSessionMissingError(error: unknown): boolean {
  return isSchaltError(error) && error.type === 'SessionNotFound'
}

export function isSessionAlreadyExistsError(error: unknown): boolean {
  return isSchaltError(error) && error.type === 'SessionAlreadyExists'
}

export function isGitOperationError(error: unknown): boolean {
  return isSchaltError(error) && error.type === 'GitOperationFailed'
}

export function isMergeConflictError(error: unknown): boolean {
  return isSchaltError(error) && error.type === 'MergeConflict'
}

export function isTerminalError(error: unknown): boolean {
  return (
    isSchaltError(error) &&
    (error.type === 'TerminalNotFound' || error.type === 'TerminalOperationFailed')
  )
}
