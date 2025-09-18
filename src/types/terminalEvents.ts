export const TERMINAL_RESET_EVENT = 'schaltwerk:reset-terminals'

export type TerminalResetDetail =
  | { kind: 'orchestrator' }
  | { kind: 'session'; sessionId: string }

export const createTerminalResetEvent = (detail: TerminalResetDetail): CustomEvent<TerminalResetDetail> =>
  new CustomEvent(TERMINAL_RESET_EVENT, { detail })
