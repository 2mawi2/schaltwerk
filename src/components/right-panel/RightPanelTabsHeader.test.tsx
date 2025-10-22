import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RightPanelTabsHeader } from './RightPanelTabsHeader'

const renderHeader = (overrides: Partial<Parameters<typeof RightPanelTabsHeader>[0]> = {}) => {
  const props = {
    activeTab: 'changes' as const,
    localFocus: false,
    showChangesTab: true,
    showInfoTab: false,
    showHistoryTab: false,
    showSpecTab: false,
    showSpecsTab: false,
    onSelectTab: vi.fn(),
    ...overrides
  }

  const result = render(<RightPanelTabsHeader {...props} />)
  return { ...result, props }
}

describe('RightPanelTabsHeader', () => {
  it('renders nothing when no tabs are visible', () => {
    const { container } = renderHeader({
      showChangesTab: false,
      showInfoTab: false,
      showHistoryTab: false,
      showSpecTab: false,
      showSpecsTab: false
    })

    expect(container).toBeEmptyDOMElement()
  })

  it('renders expected buttons when flags are enabled', () => {
    renderHeader({
      showChangesTab: true,
      showInfoTab: true,
      showHistoryTab: true,
      showSpecTab: true,
      showSpecsTab: true
    })

    expect(screen.getByTitle('Changes')).toBeInTheDocument()
    expect(screen.getByTitle('Spec Info')).toBeInTheDocument()
    expect(screen.getByTitle('Git History')).toBeInTheDocument()
    expect(screen.getByTitle('Spec')).toHaveAttribute('data-onboarding', 'specs-workspace-tab')
    expect(screen.getByTitle('Specs Workspace')).toHaveAttribute('data-onboarding', 'specs-workspace-tab')
  })

  it('invokes onSelectTab with the chosen tab', async () => {
    const user = userEvent.setup()
    const { props } = renderHeader({
      showChangesTab: true,
      showHistoryTab: true,
      showSpecTab: true,
      showSpecsTab: true
    })

    await user.click(screen.getByTitle('Git History'))
    expect(props.onSelectTab).toHaveBeenCalledWith('history')

    await user.click(screen.getByTitle('Specs Workspace'))
    expect(props.onSelectTab).toHaveBeenCalledWith('specs')
  })

  it('marks the active tab via data attribute', () => {
    renderHeader({ activeTab: 'history', showHistoryTab: true })
    const historyButton = screen.getByTitle('Git History')
    expect(historyButton.getAttribute('data-active')).toBe('true')
  })
})
