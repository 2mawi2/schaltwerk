export type MockFn = {
  (...args: unknown[]): unknown
  mock?: {
    calls: unknown[][]
    results: unknown[]
    instances: unknown[]
  }
  mockClear?: () => void
  mockReset?: () => void
  mockRestore?: () => void
  mockImplementation?: (fn: (...args: unknown[]) => unknown) => MockFn
  mockReturnValue?: (value: unknown) => MockFn
  mockResolvedValue?: (value: unknown) => MockFn
  mockRejectedValue?: (value: unknown) => MockFn
}

export interface MockTauriAPI {
  invoke: MockFn
  listen: MockFn
  emit: MockFn
}

export interface MockEventSystem {
  listenEvent: MockFn
  listenTerminalOutput: MockFn
  clearListeners: MockFn
}

export interface MockLogger {
  info: MockFn
  warn: MockFn
  error: MockFn
  debug: MockFn
}

export interface MockXTerm {
  __instances: MockXTerm[]
  options: Record<string, unknown>
  cols: number
  rows: number
  write: MockFn
  loadAddon: MockFn
  buffer: {
    active: {
      viewportY: number
      length: number
      baseY: number
      cursorY: number
    }
  }
  parser: {
    registerOscHandler: MockFn
  }
  keyHandler: ((e: KeyboardEvent) => boolean) | null
  dataHandler: ((d: string) => void) | null
  open: (el: HTMLElement) => void
  attachCustomKeyEventHandler: (fn: (e: KeyboardEvent) => boolean) => boolean
  onData: (fn: (d: string) => void) => void
  scrollToBottom: () => void
  focus: () => void
  dispose: () => void
}

export interface MockSelection {
  kind: 'session' | 'orchestrator'
  payload?: string
  isSpec?: boolean
}

export interface MockSessionInfo {
  session_id: string
  session_name: string
  session_state: 'spec' | 'running' | 'reviewed'
  branch_name: string
  base_branch: string
  created_at: string
  updated_at?: string
  spec_content?: string
  worktree_path?: string
  process_info?: {
    pid: number
    created_at: string
  }
  git_stats?: {
    files_changed: number
    insertions: number
    deletions: number
  }
}

export interface MockEnrichedSession {
  info: MockSessionInfo
  idle?: boolean
  hasUncommitted?: boolean
  gitInfo?: {
    files_changed: number
    insertions: number
    deletions: number
  }
}

export interface MockGlobalState {
  sessions: MockEnrichedSession[]
  selection: MockSelection | null
  isLoading: boolean
  error: string | null
}

export interface MockTerminalData {
  id: string
  output: string
  isActive: boolean
}

export interface MockModalProps {
  open: boolean
  onClose: MockFn
  onSubmit?: MockFn
  initialData?: Record<string, unknown>
}

export interface MockContextValue<T = unknown> {
  value: T
  setValue: MockFn
  loading: boolean
  error: string | null
}

export interface MockTestUtils {
  render: MockFn
  fireEvent: MockFn
  waitFor: MockFn
  screen: Record<string, MockFn>
  userEvent: Record<string, MockFn>
}