import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { UnifiedDiffView } from './UnifiedDiffView'
import { TestProviders, createChangedFile } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import type { FileDiffData } from './loadDiffs'
import type { EnrichedSession } from '../../types/session'
import type { ChangedFile } from '../../common/events'
import { FilterMode } from '../../types/sessionFilters'
import { stableSessionTerminalId } from '../../common/terminalIdentity'

let selectionState: {
  kind: 'session' | 'orchestrator'
  payload?: string
  sessionState?: 'spec' | 'processing' | 'running' | 'reviewed'
}
let sessionsState: EnrichedSession[]
const demoTerminals = { top: 'session-demo-top', bottomBase: 'session-demo-bottom' }

const invokeMock = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: Parameters<typeof invokeMock>) => invokeMock(...args)
}))

const sampleDiffA: FileDiffData = {
  file: createChangedFile({ path: 'src/a.ts', change_type: 'modified', additions: 1, deletions: 0 }),
  diffResult: [
    { type: 'unchanged', oldLineNumber: 1, newLineNumber: 1, content: 'const a = 1' },
    { type: 'added', newLineNumber: 2, content: 'const b = 2' },
  ],
  changedLinesCount: 1,
  fileInfo: { sizeBytes: 12, language: 'typescript' },
}

const sampleDiffB: FileDiffData = {
  file: createChangedFile({ path: 'src/b.ts', change_type: 'modified', additions: 2, deletions: 1 }),
  diffResult: [
    { type: 'unchanged', oldLineNumber: 1, newLineNumber: 1, content: 'const c = 3' },
    { type: 'added', newLineNumber: 2, content: 'const d = 4' },
  ],
  changedLinesCount: 1,
  fileInfo: { sizeBytes: 14, language: 'typescript' },
}

const sampleDiffC: FileDiffData = {
  file: createChangedFile({ path: 'src/c.ts', change_type: 'modified', additions: 3, deletions: 2 }),
  diffResult: [
    { type: 'unchanged', oldLineNumber: 1, newLineNumber: 1, content: 'const e = 5' },
    { type: 'added', newLineNumber: 2, content: 'const f = 6' },
  ],
  changedLinesCount: 1,
  fileInfo: { sizeBytes: 16, language: 'typescript' },
}

const changedFiles: ChangedFile[] = [sampleDiffA.file, sampleDiffB.file, sampleDiffC.file]

const loadFileDiffMock = vi.fn(async (_session: string | null, file: ChangedFile) => {
  if (file.path === 'src/b.ts') return sampleDiffB
  if (file.path === 'src/c.ts') return sampleDiffC
  return sampleDiffA
})

vi.mock('./loadDiffs', async () => {
  const actual = await vi.importActual<typeof import('./loadDiffs')>('./loadDiffs')
  return {
    ...actual,
    loadFileDiff: (...args: Parameters<typeof loadFileDiffMock>) => loadFileDiffMock(...args),
    loadCommitFileDiff: vi.fn(),
  }
})

vi.mock('../../hooks/useSelection', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../hooks/useSelection')
  return {
    ...actual,
    useSelection: () => ({
      selection: selectionState,
      terminals: { ...demoTerminals, workingDirectory: '/tmp' },
      setSelection: vi.fn(),
      clearTerminalTracking: vi.fn(),
      isReady: true,
      isSpec: false,
    }),
  }
})

vi.mock('../../hooks/useSessions', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/useSessions')>('../../hooks/useSessions')
  return {
    ...actual,
    useSessions: () => ({
      sessions: sessionsState,
      allSessions: sessionsState,
      filteredSessions: sessionsState,
      sortedSessions: sessionsState,
      loading: false,
      filterMode: FilterMode.Running,
      searchQuery: '',
      isSearchVisible: false,
      setFilterMode: vi.fn(),
      setSearchQuery: vi.fn(),
      setIsSearchVisible: vi.fn(),
      setCurrentSelection: vi.fn(),
      reloadSessions: vi.fn(),
      updateSessionStatus: vi.fn(),
      createDraft: vi.fn(),
    }),
  }
})

vi.mock('../../common/eventSystem', async () => {
  const actual = await vi.importActual<typeof import('../../common/eventSystem')>('../../common/eventSystem')
  return {
    ...actual,
    listenEvent: vi.fn(async () => () => {}),
  }
})

const baseInvoke = async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  switch (cmd) {
    case TauriCommands.GetChangedFilesFromMain:
    case TauriCommands.GetOrchestratorWorkingChanges:
      return changedFiles
    case TauriCommands.GetCurrentBranchName:
      return 'schaltwerk/demo'
    case TauriCommands.GetBaseBranchName:
      return 'main'
    case TauriCommands.GetCommitComparisonInfo:
      return ['abc', 'def']
    case TauriCommands.GetSessionPreferences:
      return { always_show_large_diffs: false }
    case TauriCommands.GetProjectSettings:
      return { project_name: 'demo', project_path: '/tmp/demo' }
    case TauriCommands.ListAvailableOpenApps:
      return []
    case TauriCommands.GetDefaultOpenApp:
      return 'code'
    case TauriCommands.GetActiveProjectPath:
      return '/tmp/demo'
    case TauriCommands.SchaltwerkCoreGetSession:
      return { worktree_path: '/tmp/demo' }
    case TauriCommands.ClipboardWriteText:
    case TauriCommands.SetDiffViewPreferences:
      return undefined
    default:
      throw new Error(`Unhandled invoke: ${cmd} ${JSON.stringify(args)}`)
  }
}

const createSession = (overrides: Partial<EnrichedSession['info']> = {}): EnrichedSession => ({
  info: {
    session_id: 'demo',
    display_name: 'Demo Session',
    branch: 'feature/demo',
    worktree_path: '/tmp/demo',
    base_branch: 'main',
    status: 'active',
    is_current: true,
    session_type: 'worktree',
    session_state: 'running',
    ready_to_merge: false,
    has_uncommitted_changes: false,
    ...overrides,
  },
  status: undefined,
  terminals: [stableSessionTerminalId('demo', 'top'), stableSessionTerminalId('demo', 'bottom')],
})

class MockIntersectionObserver {
  constructor(
    _callback: IntersectionObserverCallback,
    _options?: IntersectionObserverInit,
  ) {}
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn(() => [])
}

const createRect = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
  top: y,
  left: x,
  right: x + width,
  bottom: y + height,
  toJSON: () => ({ x, y, width, height }),
})

function ControlledSidebarHarness({
  filePath,
  onSelectionChange
}: {
  filePath: string | null
  onSelectionChange?: (path: string | null) => void
}) {
  return (
    <TestProviders>
      <UnifiedDiffView
        filePath={filePath}
        isOpen={true}
        onClose={() => {}}
        viewMode="sidebar"
        onSelectedFileChange={onSelectionChange}
      />
    </TestProviders>
  )
}

describe('UnifiedDiffView inline diff filePath prop scrolling', () => {
  let originalIntersectionObserver: typeof IntersectionObserver | undefined
  let rafSpy: MockInstance<(callback: FrameRequestCallback) => number> | undefined

  beforeEach(() => {
    selectionState = { kind: 'session', payload: 'demo', sessionState: 'running' }
    sessionsState = [createSession()]
    invokeMock.mockImplementation(baseInvoke)
    loadFileDiffMock.mockClear()
    originalIntersectionObserver = globalThis.IntersectionObserver
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      return window.setTimeout(() => cb(performance.now()), 0) as unknown as number
    })
  })

  afterEach(() => {
    invokeMock.mockReset()
    rafSpy?.mockRestore()
    if (originalIntersectionObserver) {
      globalThis.IntersectionObserver = originalIntersectionObserver
    } else {
      // @ts-expect-error - cleanup test shim
      delete globalThis.IntersectionObserver
    }
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('scrolls to the file when filePath prop changes in sidebar mode', async () => {
    let scrollTopAfterChange = 0
    const scrollToMock = vi.fn()

    const { rerender } = render(<ControlledSidebarHarness filePath="src/a.ts" />)

    await waitFor(() => expect(loadFileDiffMock).toHaveBeenCalled())

    const scrollContainer = await screen.findByTestId('diff-scroll-container')
    const fileA = scrollContainer.querySelector('[data-file-path="src/a.ts"]') as HTMLElement | null
    const fileB = scrollContainer.querySelector('[data-file-path="src/b.ts"]') as HTMLElement | null
    const fileC = scrollContainer.querySelector('[data-file-path="src/c.ts"]') as HTMLElement | null

    expect(fileA).not.toBeNull()
    expect(fileB).not.toBeNull()
    expect(fileC).not.toBeNull()

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    scrollContainer.getBoundingClientRect = () => createRect(0, 0, 800, 600)
    fileA!.getBoundingClientRect = () => createRect(0, 0, 800, 400)
    fileB!.getBoundingClientRect = () => createRect(0, 400, 800, 400)
    fileC!.getBoundingClientRect = () => createRect(0, 800, 800, 400)

    Object.defineProperty(scrollContainer, 'scrollTop', {
      get: () => scrollTopAfterChange,
      set: (val: number) => { scrollTopAfterChange = val },
      configurable: true
    })
    scrollContainer.scrollTo = scrollToMock

    rerender(<ControlledSidebarHarness filePath="src/c.ts" />)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })

    expect(scrollTopAfterChange).toBeGreaterThan(0)
  })
})
