import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RightPanelTabs } from './RightPanelTabs'

// Mock contexts used by RightPanelTabs
vi.mock('../../contexts/SelectionContext', () => ({
  useSelection: () => ({ selection: { kind: 'session', payload: 'test-session' }, isSpec: false })
}))

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ projectPath: '/tmp/project' })
}))

vi.mock('../../contexts/FocusContext', () => ({
  useFocus: () => ({ setFocusForSession: vi.fn(), currentFocus: null })
}))

// Mock heavy children to simple markers
vi.mock('../diff/SimpleDiffPanel', () => ({
  SimpleDiffPanel: ({ isCommander }: { isCommander?: boolean }) => (
    <div data-testid="diff-panel" data-commander={String(!!isCommander)} />
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
  })

  it('renders Spec above the Copy bar and Diff for running sessions', () => {
    render(
      <RightPanelTabs
        onFileSelect={vi.fn()}
        selectionOverride={{ kind: 'session', payload: 'test-session' }}
        isSpecOverride={false}
      />
    )

    // Spec content (top) and Diff panel (bottom) should both be present
    expect(screen.getByTestId('diff-panel')).toBeInTheDocument()
    expect(screen.getByTestId('spec-content')).toBeInTheDocument()
    expect(screen.getByTestId('copy-bundle-bar')).toBeInTheDocument()

    // No tab headers should be visible in split mode
    expect(screen.queryByTitle('Changes')).toBeNull()

    // Ensure no extra top header tabs in split mode (already checked)
  })

  it('persists user tab selection when switching away and back to orchestrator', async () => {
    const user = userEvent.setup()
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
})
