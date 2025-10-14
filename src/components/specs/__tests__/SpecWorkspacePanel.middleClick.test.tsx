import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SpecWorkspacePanel } from '../SpecWorkspacePanel'
import { SessionState, EnrichedSession } from '../../../types/session'

vi.mock('../../plans/SpecEditor', () => ({
  SpecEditor: ({ sessionName }: { sessionName: string }) => (
    <div data-testid="mock-spec-editor">{sessionName}</div>
  )
}))

vi.mock('../../../common/eventSystem', () => ({
  listenEvent: vi.fn().mockResolvedValue(() => {}),
  SchaltEvent: {
    SessionsRefreshed: 'schaltwerk:sessions-refreshed'
  }
}))

vi.mock('../../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

describe('SpecWorkspacePanel middle-click behavior', () => {
  const specId = 'spec-123'
  const baseSpec: EnrichedSession = {
    info: {
      session_id: specId,
      display_name: 'Spec Example',
      branch: 'spec/example',
      worktree_path: '/tmp/spec/example',
      base_branch: 'main',
      status: 'spec',
      is_current: false,
      session_type: 'worktree',
      session_state: SessionState.Spec
    },
    terminals: []
  }

  beforeEach(() => {
    cleanup()
  })

  it('closes a spec tab when middle-clicked', () => {
    const handleClose = vi.fn()
    const handleChange = vi.fn()

    render(
      <SpecWorkspacePanel
        specs={[baseSpec]}
        openTabs={[specId]}
        activeTab={specId}
        onTabChange={handleChange}
        onTabClose={handleClose}
        onOpenPicker={() => {}}
        showPicker={false}
        onPickerClose={() => {}}
      />
    )

    const tabLabel = screen.getByText('Spec Example')
    fireEvent.mouseDown(tabLabel, { button: 1 })

    expect(handleClose).toHaveBeenCalledWith(specId)
    expect(handleChange).not.toHaveBeenCalled()
  })
})
