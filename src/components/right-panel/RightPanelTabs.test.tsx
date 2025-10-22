import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as splitDragCoordinator from '../../utils/splitDragCoordinator'
import type { ReactNode } from 'react'
import type { EnrichedSession, SessionInfo } from '../../types/session'

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

import { RightPanelTabs } from './RightPanelTabs'

// Mock contexts used by RightPanelTabs
vi.mock('../../contexts/SelectionContext', () => ({
  useSelection: () => ({
    selection: { kind: 'session', payload: 'test-session', worktreePath: '/tmp/session-worktree' },
    isSpec: false,
    setSelection: vi.fn()
  })
}))

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ projectPath: '/tmp/project' })
}))

vi.mock('../../contexts/FocusContext', () => ({
  useFocus: () => ({ setFocusForSession: vi.fn(), currentFocus: null })
}))

vi.mock('../../contexts/SessionsContext', () => ({
  useSessions: () => ({ allSessions: mockSessions })
}))

// Mock heavy children to simple markers
vi.mock('../diff/SimpleDiffPanel', () => ({
  SimpleDiffPanel: ({ isCommander }: { isCommander?: boolean }) => (
    <div data-testid="diff-panel" data-commander={String(!!isCommander)} />
  )
}))

vi.mock('../git-graph/GitGraphPanel', () => ({
  GitGraphPanel: ({ repoPath, sessionName }: { repoPath?: string | null; sessionName?: string | null }) => (
    <div data-testid="git-history" data-repo={repoPath ?? ''} data-session={sessionName ?? ''} />
  )
}))

vi.mock('../plans/SpecContentView', () => ({
  SpecContentView: ({ sessionName, editable }: { sessionName: string; editable: boolean }) => (
    <div data-testid="spec-content" data-session={sessionName} data-editable={String(editable)} />
  )
}))

vi.mock('../plans/SpecInfoPanel', () => ({
  SpecInfoPanel: () => <div data-testid="spec-info" />
}))

vi.mock('../plans/SpecMetadataPanel', () => ({
  SpecMetadataPanel: () => <div data-testid="spec-metadata" />
}))

vi.mock('./CopyBundleBar', () => ({
  CopyBundleBar: () => <div data-testid="copy-bundle-bar" />
}))

describe('RightPanelTabs split layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    splitPropsStore.current = null
    mockSessions.length = 0
  })

  it('renders Spec above the Copy bar and Diff for running sessions', () => {
    mockSessions.push(createRunningSession({
      session_id: 'test-session',
      worktree_path: '/tmp/session-worktree',
      branch: 'feature/test'
    }))

    render(
      <RightPanelTabs
        onFileSelect={vi.fn()}
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

    render(
      <RightPanelTabs
        onFileSelect={vi.fn()}
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
    const { rerender } = render(
      <RightPanelTabs
        onFileSelect={vi.fn()}
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
        onFileSelect={vi.fn()}
        selectionOverride={{ kind: 'session', payload: 'run-1' }}
        isSpecOverride={false}
      />
    )

    // Switch back to orchestrator
    rerender(
      <RightPanelTabs
        onFileSelect={vi.fn()}
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

    render(
      <RightPanelTabs
        onFileSelect={vi.fn()}
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

    render(
      <RightPanelTabs
        onFileSelect={vi.fn()}
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

    render(
      <RightPanelTabs
        onFileSelect={vi.fn()}
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

    render(
      <RightPanelTabs
        onFileSelect={vi.fn()}
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

    const { rerender } = render(
      <RightPanelTabs
        onFileSelect={vi.fn()}
        selectionOverride={{ kind: 'session', payload: 'run-session', worktreePath: '/tmp/run-session' }}
        isSpecOverride={false}
      />
    )

    await user.click(screen.getByTitle('Spec'))
    expect(screen.getByTitle('Spec').getAttribute('data-active')).toBe('true')

    rerender(
      <RightPanelTabs
        onFileSelect={vi.fn()}
        selectionOverride={{ kind: 'session', payload: 'spec-session', worktreePath: '/tmp/spec-session' }}
        isSpecOverride={true}
      />
    )
    expect(screen.getByTitle('Spec Info').getAttribute('data-active')).toBe('true')

    rerender(
      <RightPanelTabs
        onFileSelect={vi.fn()}
        selectionOverride={{ kind: 'session', payload: 'run-session', worktreePath: '/tmp/run-session' }}
        isSpecOverride={false}
      />
    )

    const specButton = screen.getByTitle('Spec')
    expect(specButton.getAttribute('data-active')).toBe('true')
    expect(screen.getByTitle('Changes').getAttribute('data-active')).not.toBe('true')
  })

  it('shows info and history tabs for spec session with history positioned after info', () => {
    mockSessions.push(
      createRunningSession({
        session_id: 'spec-session',
        session_state: 'spec',
        status: 'spec',
        worktree_path: '/tmp/spec-session',
        branch: 'spec/feature'
      })
    )

    render(
      <RightPanelTabs
        onFileSelect={vi.fn()}
        selectionOverride={{ kind: 'session', payload: 'spec-session', worktreePath: '/tmp/spec-session' }}
        isSpecOverride={true}
      />
    )

    const infoButton = screen.getByTitle('Spec Info')
    const historyButton = screen.getByTitle('Git History')
    expect(infoButton).toBeInTheDocument()
    expect(historyButton).toBeInTheDocument()
    const order = infoButton.compareDocumentPosition(historyButton)
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
