export enum UiEvent {
  PermissionError = 'schaltwerk:permission-error',
  BackgroundStartMarked = 'schaltwerk:terminal-background-started',
  TerminalResizeRequest = 'schaltwerk:terminal-resize-request',
  TerminalReset = 'schaltwerk:reset-terminals',
  OpencodeSelectionResize = 'schaltwerk:opencode-selection-resize',
  OpencodeSearchResize = 'schaltwerk:opencode-search-resize',
  FocusTerminal = 'schaltwerk:focus-terminal',
  TerminalReady = 'schaltwerk:terminal-ready',
  RunScriptUpdated = 'schaltwerk:run-script-updated',
  SessionAction = 'schaltwerk:session-action',
  StartAgentFromSpec = 'schaltwerk:start-agent-from-spec',
  NewSessionPrefill = 'schaltwerk:new-session:prefill',
  NewSessionPrefillPending = 'schaltwerk:new-session:prefill-pending',
  NewSessionSetSpec = 'schaltwerk:new-session:set-spec',
  NewSessionRequest = 'schaltwerk:new-session',
  NewSpecRequest = 'schaltwerk:new-spec',
  SessionCreated = 'schaltwerk:session-created',
  SpecCreated = 'schaltwerk:spec-created',
  RetryAgentStart = 'schaltwerk:retry-agent-start',
  OpenNewProjectDialog = 'schaltwerk:open-new-project-dialog',
  OpenDiffView = 'schaltwerk:open-diff-view',
  OpenDiffFile = 'schaltwerk:open-diff-file',
  TerminalFontUpdated = 'schaltwerk:terminal-font-updated',
  TerminalRendererUpdated = 'schaltwerk:terminal-renderer-updated',
  FontSizeChanged = 'font-size-changed',
  GlobalNewSessionShortcut = 'global-new-session-shortcut',
  GlobalMarkReadyShortcut = 'global-mark-ready-shortcut',
  NoProjectError = 'schaltwerk:no-project-error',
  SpawnError = 'schaltwerk:spawn-error',
  NotGitError = 'schaltwerk:not-git-error',
  ModalsChanged = 'schaltwerk:modals-changed',
  EnterSpecMode = 'schaltwerk:enter-spec-mode',
  CreatePullRequest = 'schaltwerk:create-pull-request',
}

export interface TerminalResizeRequestDetail {
  target: 'session' | 'orchestrator' | 'all'
  sessionId?: string
}

export type TerminalResetDetail =
  | { kind: 'orchestrator' }
  | { kind: 'session'; sessionId: string }

export type SelectionResizeDetail =
  | { kind: 'session'; sessionId: string }
  | { kind: 'orchestrator' }

export interface FocusTerminalDetail {
  terminalId?: string
  focusType?: 'terminal' | 'claude'
}

export interface SessionActionDetail {
  action: 'cancel' | 'cancel-immediate' | 'delete-spec'
  sessionId: string
  sessionName: string
  sessionDisplayName?: string
  branch?: string
  hasUncommittedChanges?: boolean
}

export interface StartAgentFromSpecDetail {
  name?: string
}

export interface NewSessionPrefillDetail {
  name?: string
  taskContent?: string
  baseBranch?: string
  lockName?: boolean
  fromDraft?: boolean
  originalSpecName?: string
}

export interface SessionCreatedDetail {
  name: string
}

export interface SpecCreatedDetail {
  name: string
}

export interface OpenDiffFileDetail {
  filePath?: string
}

export interface TerminalFontUpdatedDetail {
  fontFamily: string | null
}

export interface TerminalRendererUpdatedDetail {
  webglEnabled: boolean
}

export interface FontSizeChangedDetail {
  terminalFontSize: number
  uiFontSize: number
}

export interface TerminalErrorDetail {
  error: string
  terminalId: string
}

export interface RunScriptUpdatedDetail {
  hasRunScript: boolean
}

export interface ModalsChangedDetail {
  openCount: number
}

export interface EnterSpecModeDetail {
  sessionName: string
}

export interface CreatePullRequestDetail {
  sessionId: string
}

export type UiEventPayloads = {
  [UiEvent.PermissionError]: { error: string }
  [UiEvent.BackgroundStartMarked]: { terminalId: string }
  [UiEvent.TerminalResizeRequest]: TerminalResizeRequestDetail
  [UiEvent.TerminalReset]: TerminalResetDetail
  [UiEvent.OpencodeSelectionResize]: SelectionResizeDetail
  [UiEvent.OpencodeSearchResize]: SelectionResizeDetail
  [UiEvent.FocusTerminal]: FocusTerminalDetail | undefined
  [UiEvent.TerminalReady]: { terminalId: string }
  [UiEvent.RunScriptUpdated]: RunScriptUpdatedDetail
  [UiEvent.SessionAction]: SessionActionDetail
  [UiEvent.StartAgentFromSpec]: StartAgentFromSpecDetail | undefined
  [UiEvent.NewSessionPrefill]: NewSessionPrefillDetail | undefined
  [UiEvent.NewSessionPrefillPending]: undefined
  [UiEvent.NewSessionSetSpec]: undefined
  [UiEvent.NewSessionRequest]: undefined
  [UiEvent.NewSpecRequest]: undefined
  [UiEvent.SessionCreated]: SessionCreatedDetail
  [UiEvent.SpecCreated]: SpecCreatedDetail
  [UiEvent.RetryAgentStart]: undefined
  [UiEvent.OpenNewProjectDialog]: undefined
  [UiEvent.OpenDiffView]: undefined
  [UiEvent.OpenDiffFile]: OpenDiffFileDetail | undefined
  [UiEvent.TerminalFontUpdated]: TerminalFontUpdatedDetail
  [UiEvent.TerminalRendererUpdated]: TerminalRendererUpdatedDetail
  [UiEvent.FontSizeChanged]: FontSizeChangedDetail
  [UiEvent.GlobalNewSessionShortcut]: undefined
  [UiEvent.GlobalMarkReadyShortcut]: undefined
  [UiEvent.NoProjectError]: TerminalErrorDetail
  [UiEvent.SpawnError]: TerminalErrorDetail
  [UiEvent.NotGitError]: TerminalErrorDetail
  [UiEvent.ModalsChanged]: ModalsChangedDetail
  [UiEvent.EnterSpecMode]: EnterSpecModeDetail
  [UiEvent.CreatePullRequest]: CreatePullRequestDetail
}

type UiEventArgs<T extends UiEvent> = undefined extends UiEventPayloads[T]
  ? [UiEventPayloads[T]?]
  : [UiEventPayloads[T]]

export function emitUiEvent<T extends UiEvent>(event: T, ...args: UiEventArgs<T>): void {
  const detail = (args.length > 0 ? args[0] : undefined) as UiEventPayloads[T]
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
const bgStarted = new Set<string>()  // terminalId strings, e.g., "session-foo-top"

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

/**
 * Mark a terminal as background-started while executing the provided async fn.
 * If fn throws, roll back the mark to allow another component to retry.
 */
export async function withBackgroundStart<T>(terminalId: string, fn: () => Promise<T>): Promise<T> {
  markBackgroundStart(terminalId)
  try {
    return await fn()
  } catch (e) {
    // Roll back on failure so other paths may start the agent (or user can retry)
    clearBackgroundStarts([terminalId])
    throw e
  }
}

/**
 * Clear any marks that match a prefix. Useful on project close for orchestrator terminals.
 * Example: clearBackgroundStartsByPrefix(`orchestrator-${projectId}`)
 */
export function clearBackgroundStartsByPrefix(prefix: string): void {
  const toDelete: string[] = []
  for (const id of bgStarted) {
    if (id.startsWith(prefix)) toDelete.push(id)
  }
  clearBackgroundStarts(toDelete)
}

/** @internal test/debug only */
export function __debug_getBackgroundStartIds(): string[] {
  return Array.from(bgStarted)
}
