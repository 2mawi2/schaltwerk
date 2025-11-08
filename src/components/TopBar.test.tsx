import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopBar } from './TopBar'

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn()
  })
}))

vi.mock('../utils/platform', () => ({
  getPlatform: vi.fn(async () => 'mac')
}))

vi.mock('../keyboardShortcuts/helpers', () => ({
  detectPlatformSafe: () => 'mac'
}))

vi.mock('./TabBar', () => ({
  TabBar: () => <div data-testid="tab-bar" />
}))

vi.mock('./OpenInSplitButton', () => ({
  OpenInSplitButton: () => <div data-testid="open-in-split" />
}))

vi.mock('./BranchIndicator', () => ({
  BranchIndicator: () => <div data-testid="branch-indicator" />
}))

vi.mock('./github/GithubMenuButton', () => ({
  GithubMenuButton: () => <div data-testid="github-menu" />
}))

vi.mock('./WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />
}))

vi.mock('../domains/feedback', () => ({
  FeedbackButton: ({ onClick }: { onClick: () => void }) => (
    <button data-testid="feedback" onClick={onClick}>
      Feedback
    </button>
  )
}))

describe('TopBar', () => {
  const baseProps = {
    tabs: [{ projectPath: '/tmp/project', projectName: 'Project' }],
    activeTabPath: '/tmp/project',
    onGoHome: vi.fn(),
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenFeedback: vi.fn(),
  }

  it('renders a left panel toggle when handler is provided', () => {
    const onToggleLeftPanel = vi.fn()

    render(
      <TopBar
        {...baseProps}
        onToggleLeftPanel={onToggleLeftPanel}
        onToggleRightPanel={vi.fn()}
      />
    )

    const toggle = screen.getByLabelText('Hide left panel')
    fireEvent.click(toggle)
    expect(onToggleLeftPanel).toHaveBeenCalledTimes(1)
  })

  it('shows the correct aria label when the left panel is collapsed', () => {
    render(
      <TopBar
        {...baseProps}
        isLeftPanelCollapsed={true}
        onToggleLeftPanel={vi.fn()}
        onToggleRightPanel={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Show left panel')).toBeInTheDocument()
  })
})
