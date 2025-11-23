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

describe('TopBar', () => {
  const baseProps = {
    tabs: [{ projectPath: '/tmp/project', projectName: 'Project' }],
    activeTabPath: '/tmp/project',
    onGoHome: vi.fn(),
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onOpenSettings: vi.fn(),
  }

  it('renders a right panel toggle when handler is provided', () => {
    const onToggleRightPanel = vi.fn()

    render(
      <TopBar
        {...baseProps}
        onToggleRightPanel={onToggleRightPanel}
      />
    )

    const toggle = screen.getByLabelText('Hide right panel')
    fireEvent.click(toggle)
    expect(onToggleRightPanel).toHaveBeenCalledTimes(1)
  })

  it('shows the correct aria label when the right panel is collapsed', () => {
    render(
      <TopBar
        {...baseProps}
        isRightPanelCollapsed={true}
        onToggleRightPanel={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Show right panel')).toBeInTheDocument()
  })
})
