import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as splitDragCoordinator from '../../utils/splitDragCoordinator'
import type { ReactNode } from 'react'
import type { EnrichedSession, SessionInfo } from '../../types/session'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'

interface MockSplitProps {
  onDragStart?: (sizes: number[], gutterIndex: number, event: MouseEvent) => void
  onDragEnd?: (sizes: number[], gutterIndex: number, event: MouseEvent) => void
  [key: string]: unknown
}

const splitPropsStore: { current: MockSplitProps | null } = { current: null }
const mockSessions: EnrichedSession[] = []

const createRunningSession = ({ session_id, ...rest }: Partial<SessionInfo> & { session_id: string }): EnrichedSession => ({
  info: {
    session_id,
    branch: rest.branch ?? 'feature/default',
    worktree_path: rest.worktree_path ?? '/tmp/default',
    base_branch: rest.base_branch ?? 'main',
    status: rest.status ?? 'active',
    is_current: rest.is_current ?? false,
    session_type: rest.session_type ?? 'worktree',
    session_state: rest.session_state ?? 'running',
    ready_to_merge: rest.ready_to_merge ?? false,
    ...rest,
  },
  terminals: [],
})

vi.mock('react-split', () => {
  const SplitMock = ({ children, ...props }: MockSplitProps & { children: ReactNode }) => {
    splitPropsStore.current = props
    return <div data-testid="split-mock">{children}</div>
  }

  return {
    __esModule: true,
    default: SplitMock
  }
})

import { Provider, createStore } from 'jotai'
import { RightPanelTabs } from './RightPanelTabs'
import { projectPathAtom } from '../../store/atoms/project'
import type { ReactElement } from 'react'

// Mock contexts used by RightPanelTabs
vi.mock('../../hooks/useSelection', () => ({
  useSelection: () => ({
    selection: { kind: 'session', payload: 'test-session', worktreePath: '/tmp/session-worktree' },
    isSpec: false,
    setSelection: vi.fn()
  })
}))

const mockSetFocusForSession = vi.fn()

vi.mock('../../contexts/FocusContext', () => ({
  useFocus: () => ({ setFocusForSession: mockSetFocusForSession, currentFocus: null })
}))

vi.mock('../../hooks/useSessions', () => ({
  useSessions: () => ({ allSessions: mockSessions })
}))

// Mock heavy children to simple markers
let latestDiffProps: { mode?: string; activeFile?: string | null } = {}

vi.mock('../diff/SimpleDiffPanel', () => ({
  SimpleDiffPanel: ({ isCommander, mode, activeFile }: { isCommander?: boolean; mode?: string; activeFile?: string | null }) => {
    latestDiffProps = { mode, activeFile }
    return (
      <div
        data-testid="diff-panel"
        data-commander={String(!!isCommander)}
        data-mode={mode ?? ''}
        data-active-file={activeFile ?? ''}
      />
    )
  }
}))

vi.mock('../git-graph/GitGraphPanel', () => ({
  GitGraphPanel: ({ repoPath, sessionName }: { repoPath?: string | null; sessionName?: string | null }) => (
    <div data-testid="git-history" data-repo={repoPath ?? ''} data-session={sessionName ?? ''} />
  )
}))

vi.mock('../specs/SpecContentView', () => ({
  SpecContentView: ({ sessionName, editable }: { sessionName: string; editable: boolean }) => (
    <div data-testid="spec-content" data-session={sessionName} data-editable={String(editable)} />
  )
}))

vi.mock('../specs/SpecInfoPanel', () => ({
  SpecInfoPanel: () => <div data-testid="spec-info" />
}))

vi.mock('../specs/SpecMetadataPanel', () => ({
  SpecMetadataPanel: () => <div data-testid="spec-metadata" />
}))

vi.mock('./CopyContextBar', () => ({
  CopyContextBar: () => <div data-testid="copy-bundle-bar">CopyContextBar</div>
}))

vi.mock('../specs/SpecWorkspacePanel', () => ({
  SpecWorkspacePanel: ({ openTabs }: { openTabs: string[] }) => (
    <div data-testid="spec-workspace-panel" data-open-tabs={openTabs.join(',')} />
  )
}))

function renderWithProject(ui: ReactElement, projectPath: string | null = '/tmp/project') {
  const store = createStore()
  store.set(projectPathAtom, projectPath)
  const result = render(<Provider store={store}>{ui}</Provider>)
  return {
    ...result,
    rerender(nextUi: ReactElement) {
      result.rerender(<Provider store={store}>{nextUi}</Provider>)
    },
  }
}

describe('RightPanelTabs split layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    splitPropsStore.current = null
    mockSessions.length = 0
    mockSetFocusForSession.mockReset()
  })

  it('renders Spec above the Copy bar and Diff for running sessions', () => {
    mockSessions.push(createRunningSession({
      session_id: 'test-session',
      worktree_path: '/tmp/session-worktree',
      branch: 'feature/test'
    }))

    renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'test-session', worktreePath: '/tmp/session-worktree' }}
        isSpecOverride={false}
      />
    )

    // Tab headers should be visible for running sessions
    expect(screen.getByTitle('Changes')).toBeInTheDocument()
    expect(screen.getByTitle('Spec')).toBeInTheDocument()
    expect(screen.getByTitle('Git History')).toBeInTheDocument()

    // Split layout should render diff and spec content together
    expect(screen.getByTestId('split-mock')).toBeInTheDocument()
    expect(screen.getByTestId('diff-panel')).toBeInTheDocument()
    expect(screen.getByTestId('spec-content')).toBeInTheDocument()
    expect(screen.getByTestId('copy-bundle-bar')).toBeInTheDocument()

    // History panel should not be visible until tab is selected
    expect(screen.queryByTestId('git-history')).toBeNull()
  })

  it('hides the copy bundle bar when viewing the Spec tab directly', async () => {
    const user = userEvent.setup()
    mockSessions.push(createRunningSession({
      session_id: 'test-session',
      worktree_path: '/tmp/session-worktree',
      branch: 'feature/test'
    }))

    renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'test-session', worktreePath: '/tmp/session-worktree' }}
        isSpecOverride={false}
      />
    )

    // Switch to the Spec tab
    await user.click(screen.getByTitle('Spec'))

    // Spec content should still render without the copy bundle bar
    expect(screen.getByTestId('spec-content')).toBeInTheDocument()
    expect(screen.queryByTestId('copy-bundle-bar')).toBeNull()
  })

  it('persists user tab selection when switching away and back to orchestrator', async () => {
    const user = userEvent.setup()
    mockSessions.push(createRunningSession({
      session_id: 'run-1',
      worktree_path: '/tmp/run-1',
      branch: 'feature/run-1'
    }))
    const { rerender } = renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'orchestrator' }}
      />
    )

    // Default is agent; switch to Changes
    let changesBtn = screen.getByTitle('Changes')
    await user.click(changesBtn)

    // Should mark Changes as active
    changesBtn = screen.getByTitle('Changes')
    expect(changesBtn.getAttribute('data-active')).toBe('true')

    // Switch to a running session (split mode)
    rerender(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'run-1' }}
        isSpecOverride={false}
      />
    )

    // Switch back to orchestrator
    rerender(
      <RightPanelTabs
        selectionOverride={{ kind: 'orchestrator' }}
      />
    )

    // Find Changes button again and ensure it remains active
    const changesBtn2 = screen.getByTitle('Changes')
    expect(changesBtn2.getAttribute('data-active')).toBe('true')
  })

  it('cleans up internal split drag if react-split misses onDragEnd', async () => {
    const endSpy = vi.spyOn(splitDragCoordinator, 'endSplitDrag')
    mockSessions.push(createRunningSession({
      session_id: 'test-session',
      worktree_path: '/tmp/session-worktree',
      branch: 'feature/test'
    }))

    renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'test-session' }}
        isSpecOverride={false}
      />
    )

    await Promise.resolve()

    const splitProps = splitPropsStore.current
    expect(splitProps?.onDragStart).toBeTypeOf('function')

    splitProps?.onDragStart?.([60, 40], 0, new MouseEvent('mousedown'))

    const callsBeforePointer = endSpy.mock.calls.length
    window.dispatchEvent(new Event('pointerup'))

    expect(endSpy.mock.calls.length).toBeGreaterThan(callsBeforePointer)
    const lastCall = endSpy.mock.calls.at(-1)
    expect(lastCall?.[0]).toBe('right-panel-internal')
    expect(document.body.classList.contains('is-split-dragging')).toBe(false)
  })

  it('shows git history panel with session worktree when history tab selected', async () => {
    const user = userEvent.setup()
    mockSessions.push(createRunningSession({
      session_id: 'test-session',
      worktree_path: '/tmp/session-worktree',
      branch: 'feature/test'
    }))

    renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'test-session', worktreePath: '/tmp/session-worktree' }}
        isSpecOverride={false}
      />
    )

    await user.click(screen.getByTitle('Git History'))

    const historyPanel = screen.getByTestId('git-history')
    expect(historyPanel).toBeInTheDocument()
    expect(historyPanel).toHaveAttribute('data-repo', '/tmp/session-worktree')
    expect(historyPanel).toHaveAttribute('data-session', 'test-session')
    expect(screen.queryByTestId('split-mock')).toBeNull()
    expect(screen.queryByTestId('copy-bundle-bar')).toBeNull()
  })

  it('uses session id for history panel when selection payload resolves via branch', async () => {
    const user = userEvent.setup()
    mockSessions.push(createRunningSession({
      session_id: 'alias-session',
      worktree_path: '/tmp/alias-worktree',
      branch: 'feature/alias-branch'
    }))

    renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'feature/alias-branch', worktreePath: '/tmp/alias-worktree' }}
        isSpecOverride={false}
      />
    )

    await user.click(screen.getByTitle('Git History'))

    const historyPanel = screen.getByTestId('git-history')
    expect(historyPanel).toBeInTheDocument()
    expect(historyPanel).toHaveAttribute('data-repo', '/tmp/alias-worktree')
    expect(historyPanel).toHaveAttribute('data-session', 'alias-session')
  })

  it('passes null session name to history panel in orchestrator view', async () => {
    const user = userEvent.setup()

    renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'orchestrator' }}
      />
    )

    await user.click(screen.getByTitle('Git History'))

    const historyPanel = screen.getByTestId('git-history')
    expect(historyPanel).toHaveAttribute('data-session', '')
    expect(historyPanel).toHaveAttribute('data-repo', '/tmp/project')
  })

  it('resets to changes tab when returning from spec back to running session', async () => {
    const user = userEvent.setup()
    mockSessions.push(
      createRunningSession({
        session_id: 'run-session',
        worktree_path: '/tmp/run-session',
        branch: 'feature/run-session'
      }),
      createRunningSession({
        session_id: 'spec-session',
        session_state: 'spec',
        status: 'spec',
        worktree_path: '/tmp/spec-session',
        branch: 'spec/feature'
      })
    )

    const { rerender } = renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'run-session', worktreePath: '/tmp/run-session' }}
        isSpecOverride={false}
      />
    )

    await user.click(screen.getByTitle('Spec'))
    expect(screen.getByTitle('Spec').getAttribute('data-active')).toBe('true')

    rerender(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'spec-session', worktreePath: '/tmp/spec-session' }}
        isSpecOverride={true}
      />
    )
    expect(screen.getByTitle('Spec Info').getAttribute('data-active')).toBe('true')

    rerender(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'run-session', worktreePath: '/tmp/run-session' }}
        isSpecOverride={false}
      />
    )

    const specButton = screen.getByTitle('Spec')
    expect(specButton.getAttribute('data-active')).toBe('true')
    expect(screen.getByTitle('Changes').getAttribute('data-active')).not.toBe('true')
  })

  it('shows info tab for spec session but NOT history tab', () => {
    mockSessions.push(
      createRunningSession({
        session_id: 'spec-session',
        session_state: 'spec',
        status: 'spec',
        worktree_path: '/tmp/spec-session',
        branch: 'spec/feature'
      })
    )

    renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'spec-session', worktreePath: '/tmp/spec-session' }}
        isSpecOverride={true}
      />
    )

    const infoButton = screen.getByTitle('Spec Info')
    expect(infoButton).toBeInTheDocument()
    expect(screen.queryByTitle('Git History')).toBeNull()
  })

  it('focuses changes tab and diff container when inline diff is opened via shortcut', async () => {
    mockSessions.push(createRunningSession({
      session_id: 'test-session',
      worktree_path: '/tmp/session-worktree',
      branch: 'feature/test'
    }))

    renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'test-session', worktreePath: '/tmp/session-worktree' }}
        isSpecOverride={false}
      />
    )

    act(() => {
      emitUiEvent(UiEvent.OpenInlineDiffView)
    })

    await waitFor(() => {
      expect(mockSetFocusForSession).toHaveBeenCalledWith('test-session', 'diff')
      expect(screen.getByTestId('right-panel-container')).toHaveFocus()
      expect(screen.getByTitle('Changes').getAttribute('data-active')).toBe('true')
    })
  })

  it('toggles inline review back to list when inline view shortcut is pressed again', async () => {
    mockSessions.push(createRunningSession({
      session_id: 'test-session',
      worktree_path: '/tmp/session-worktree',
      branch: 'feature/test'
    }))

    renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'test-session', worktreePath: '/tmp/session-worktree' }}
        isSpecOverride={false}
      />
    )

    act(() => {
      emitUiEvent(UiEvent.OpenInlineDiffView)
    })

    await waitFor(() => {
      expect(latestDiffProps.mode).toBe('review')
    })

    act(() => {
      emitUiEvent(UiEvent.OpenInlineDiffView)
    })

    await waitFor(() => {
      expect(latestDiffProps.mode).toBe('list')
      expect(latestDiffProps.activeFile).toBeNull()
    })
  })
})

describe('RightPanelTabs spec workspace isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSessions.length = 0
  })

  it('does NOT show SpecWorkspacePanel when SpecCreated event fires while running session is selected', async () => {
    mockSessions.push(
      createRunningSession({
        session_id: 'running-session',
        worktree_path: '/tmp/running',
        branch: 'feature/running'
      }),
      createRunningSession({
        session_id: 'new-spec',
        session_state: 'spec',
        status: 'spec',
        worktree_path: null as unknown as string,
        branch: 'spec/new-spec'
      })
    )

    renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'running-session', worktreePath: '/tmp/running' }}
        isSpecOverride={false}
      />
    )

    act(() => {
      emitUiEvent(UiEvent.SpecCreated, { name: 'new-spec' })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('spec-workspace-panel')).toBeNull()
    })
  })

  it('shows SpecWorkspacePanel when SpecCreated event fires while orchestrator is selected', async () => {
    mockSessions.push(
      createRunningSession({
        session_id: 'new-spec',
        session_state: 'spec',
        status: 'spec',
        worktree_path: null as unknown as string,
        branch: 'spec/new-spec'
      })
    )

    renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'orchestrator' }}
      />
    )

    act(() => {
      emitUiEvent(UiEvent.SpecCreated, { name: 'new-spec' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('spec-workspace-panel')).toBeInTheDocument()
    })
  })

  it('does NOT show SpecWorkspacePanel for running session even if rightPanelTab is specs', async () => {
    mockSessions.push(
      createRunningSession({
        session_id: 'running-session',
        worktree_path: '/tmp/running',
        branch: 'feature/running'
      }),
      createRunningSession({
        session_id: 'new-spec',
        session_state: 'spec',
        status: 'spec',
        worktree_path: null as unknown as string,
        branch: 'spec/new-spec'
      })
    )

    const { rerender } = renderWithProject(
      <RightPanelTabs
        selectionOverride={{ kind: 'orchestrator' }}
      />
    )

    act(() => {
      emitUiEvent(UiEvent.SpecCreated, { name: 'new-spec' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('spec-workspace-panel')).toBeInTheDocument()
    })

    rerender(
      <RightPanelTabs
        selectionOverride={{ kind: 'session', payload: 'running-session', worktreePath: '/tmp/running' }}
        isSpecOverride={false}
      />
    )

    expect(screen.queryByTestId('spec-workspace-panel')).toBeNull()
    expect(screen.getByTestId('diff-panel')).toBeInTheDocument()
  })
})
