import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, beforeEach, vi, expect } from 'vitest'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { mockEnrichedSession } from '../../test-utils/sessionMocks'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
  UnlistenFn: vi.fn(),
}))

vi.mock('../../hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}))

const mockInvoke = vi.mocked(invoke)
const mockListen = vi.mocked(listen)
const mockUnlisten = vi.fn()

const runningSession = mockEnrichedSession('running-session', 'running', false)
const specSession = mockEnrichedSession('spec-session', 'spec', false)
const reviewedSession = mockEnrichedSession('reviewed-session', 'reviewed', true)
const sampleSessions = [runningSession, specSession, reviewedSession]

async function renderCollapsedSidebar(isCollapsed = true) {
  const utils = render(
    <TestProviders>
      <Sidebar isCollapsed={isCollapsed} />
    </TestProviders>
  )

  if (isCollapsed) {
    await waitFor(() => {
      expect(screen.getByTestId('collapsed-rail')).toBeInTheDocument()
    })
  } else {
    await waitFor(() => {
      expect(screen.getByText('spec-session')).toBeInTheDocument()
    })
  }

  return utils
}

describe('Collapsed sidebar mini rail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUnlisten.mockReset()
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case TauriCommands.SchaltwerkCoreListEnrichedSessions:
          return Promise.resolve(sampleSessions)
        case TauriCommands.SchaltwerkCoreListSessionsByState:
          return Promise.resolve([])
        case TauriCommands.GetProjectSessionsSettings:
          return Promise.resolve({ filter_mode: 'all', sort_mode: 'name' })
        case TauriCommands.SetProjectSessionsSettings:
          return Promise.resolve()
        case TauriCommands.GetCurrentBranchName:
          return Promise.resolve('main')
        case TauriCommands.SchaltwerkCoreGetSession:
          return Promise.resolve({ session_id: 'mock', worktree_path: '/tmp/mock' })
        case TauriCommands.SchaltwerkCoreGetFontSizes:
          return Promise.resolve([13, 12])
        case TauriCommands.SchaltwerkCoreSetFontSizes:
          return Promise.resolve()
        default:
          return Promise.resolve()
      }
    })

    mockListen.mockImplementation(() => Promise.resolve(mockUnlisten))
  })

  it('keeps selection highlight and scroll position when collapsing to the rail', async () => {
    const { rerender, getByTestId } = await renderCollapsedSidebar(false)

    await userEvent.click(screen.getByText('spec-session'))

    const scrollContainer = getByTestId('session-scroll-container') as HTMLDivElement
    act(() => {
      scrollContainer.scrollTop = 120
      scrollContainer.dispatchEvent(new Event('scroll'))
    })

    rerender(
      <TestProviders>
        <Sidebar isCollapsed={true} />
      </TestProviders>
    )

    await waitFor(() => {
      expect(getByTestId('collapsed-rail')).toBeInTheDocument()
    })

    const collapsedScrollContainer = getByTestId('session-scroll-container') as HTMLDivElement
    expect(collapsedScrollContainer.scrollTop).toBe(120)

    const selectedCard = getByTestId('session-scroll-container').querySelector('[data-session-id="spec-session"]')
    expect(selectedCard?.getAttribute('data-session-selected')).toBe('true')
    expect(selectedCard?.className).toContain('session-ring')
  })

  it('hides inline action buttons in the rail items', async () => {
    const { container } = render(
      <TestProviders>
        <Sidebar isCollapsed={true} />
      </TestProviders>
    )

    await waitFor(() => {
      expect(screen.getByTestId('collapsed-rail')).toBeInTheDocument()
    })

    const card = container.querySelector('[data-session-id="running-session"]')
    expect(card).toBeTruthy()
    expect(card?.querySelectorAll('button').length).toBe(0)
  })

  it('does not render repository header text in collapsed rail', async () => {
    await renderCollapsedSidebar()
    expect(screen.queryByText(/Repository/)).toBeNull()
    expect(screen.queryByText(/REPO/)).toBeNull()
  })

  it('renders diff summary without visible names in collapsed rail', async () => {
    await renderCollapsedSidebar()
    // Names should not be visible in rail
    expect(screen.queryByText('spec-session')).toBeNull()
    expect(screen.queryByText('running-session')).toBeNull()
    expect(screen.queryByText('reviewed-session')).toBeNull()
    // Diff summary should show additions and deletions even when files are hidden
    expect(screen.getAllByText('+0').length).toBeGreaterThan(0)
    expect(screen.getAllByText('-0').length).toBeGreaterThan(0)
  })

  it('shows shortcut badge for first session in collapsed rail', async () => {
    await renderCollapsedSidebar()

    // First session badge should be visible (⌘2 fallback)
    expect(screen.getByText(/⌘?2/)).toBeInTheDocument()
  })
})
