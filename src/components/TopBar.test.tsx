import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { TopBar } from './TopBar'

vi.mock('./TabBar', () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}))

vi.mock('./OpenInSplitButton', () => ({
  OpenInSplitButton: () => <div data-testid="open-in-split" />,
}))

vi.mock('./BranchIndicator', () => ({
  BranchIndicator: () => <div data-testid="branch-indicator" />,
}))

vi.mock('./github/GithubMenuButton', () => ({
  GithubMenuButton: (props: { className?: string }) => (
    <div data-testid="github-menu-button" {...props} />
  ),
}))

vi.mock('./WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls" />,
}))

vi.mock('../utils/platform', () => ({
  getPlatform: vi.fn().mockResolvedValue('mac'),
}))

vi.mock('../keyboardShortcuts/helpers', () => ({
  detectPlatformSafe: () => 'mac',
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(),
  }),
}))

vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe('TopBar feedback button', () => {
  const baseProps = {
    tabs: [],
    activeTabPath: null,
    onGoHome: vi.fn(),
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onOpenSettings: vi.fn(),
  }

  it('renders a feedback button that calls onOpenFeedback when clicked', async () => {
    const user = userEvent.setup()
    const onOpenFeedback = vi.fn()

    render(
      <TopBar
        {...baseProps}
        onOpenFeedback={onOpenFeedback}
      />
    )

    const feedbackButton = await screen.findByRole('button', { name: 'Send feedback' })
    await user.click(feedbackButton)

    expect(onOpenFeedback).toHaveBeenCalledTimes(1)
  })
})
