import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { UnifiedSearchModal } from './UnifiedSearchModal'
import { ModalProvider } from '../../contexts/ModalContext'
import type { GithubIssueSelectionResult, GithubPrSelectionResult } from '../../types/githubIssues'

const mockBranchSearch = {
  branches: ['main', 'develop', 'feature/auth', 'feature/dashboard'],
  filteredBranches: ['main', 'develop', 'feature/auth', 'feature/dashboard'],
  loading: false,
  error: null,
  query: '',
  setQuery: vi.fn(),
}

vi.mock('../../hooks/useBranchSearch', () => ({
  useBranchSearch: () => mockBranchSearch,
}))

const mockIssueSearch = {
  results: [
    { number: 1, title: 'Fix login bug', state: 'open', updatedAt: '2024-01-01T00:00:00Z', author: 'alice', labels: [], url: 'https://github.com/test/1' },
    { number: 2, title: 'Add dark mode', state: 'closed', updatedAt: '2024-01-02T00:00:00Z', author: 'bob', labels: [{ name: 'enhancement', color: '0E8A16' }], url: 'https://github.com/test/2' },
  ],
  loading: false,
  error: null,
  query: '',
  setQuery: vi.fn(),
  refresh: vi.fn(),
  fetchDetails: vi.fn(),
  clearError: vi.fn(),
}

vi.mock('../../hooks/useGithubIssueSearch', () => ({
  useGithubIssueSearch: () => mockIssueSearch,
}))

const mockPrSearch = {
  results: [
    { number: 10, title: 'Feature: Auth', state: 'open', updatedAt: '2024-01-03T00:00:00Z', author: 'charlie', labels: [], url: 'https://github.com/test/10', headRefName: 'feature/auth' },
    { number: 11, title: 'Fix: Typo', state: 'merged', updatedAt: '2024-01-04T00:00:00Z', author: 'dave', labels: [], url: 'https://github.com/test/11', headRefName: 'fix/typo' },
  ],
  loading: false,
  error: null,
  query: '',
  setQuery: vi.fn(),
  refresh: vi.fn(),
  fetchDetails: vi.fn(),
  clearError: vi.fn(),
}

vi.mock('../../hooks/useGithubPrSearch', () => ({
  useGithubPrSearch: () => mockPrSearch,
}))

vi.mock('./githubIssueFormatting', () => ({
  buildIssuePrompt: vi.fn().mockReturnValue('issue prompt'),
  buildIssuePreview: vi.fn().mockReturnValue('issue preview'),
  formatIssueUpdatedTimestamp: vi.fn().mockReturnValue('2 days ago'),
}))

vi.mock('./githubPrFormatting', () => ({
  buildPrPrompt: vi.fn().mockReturnValue('pr prompt'),
  buildPrPreview: vi.fn().mockReturnValue('pr preview'),
  formatPrUpdatedTimestamp: vi.fn().mockReturnValue('1 day ago'),
}))

function renderModal(overrides: Partial<React.ComponentProps<typeof UnifiedSearchModal>> = {}) {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onSelectBranch: vi.fn(),
    onSelectIssue: vi.fn(),
    onSelectPr: vi.fn(),
    githubReady: true,
  }
  const props = { ...defaultProps, ...overrides }
  render(
    <ModalProvider>
      <UnifiedSearchModal {...props} />
    </ModalProvider>
  )
  return props
}

describe('UnifiedSearchModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBranchSearch.filteredBranches = ['main', 'develop', 'feature/auth', 'feature/dashboard']
    mockBranchSearch.loading = false
    mockIssueSearch.results = [
      { number: 1, title: 'Fix login bug', state: 'open', updatedAt: '2024-01-01T00:00:00Z', author: 'alice', labels: [], url: 'https://github.com/test/1' },
      { number: 2, title: 'Add dark mode', state: 'closed', updatedAt: '2024-01-02T00:00:00Z', author: 'bob', labels: [{ name: 'enhancement', color: '0E8A16' }], url: 'https://github.com/test/2' },
    ]
    mockPrSearch.results = [
      { number: 10, title: 'Feature: Auth', state: 'open', updatedAt: '2024-01-03T00:00:00Z', author: 'charlie', labels: [], url: 'https://github.com/test/10', headRefName: 'feature/auth' },
      { number: 11, title: 'Fix: Typo', state: 'merged', updatedAt: '2024-01-04T00:00:00Z', author: 'dave', labels: [], url: 'https://github.com/test/11', headRefName: 'fix/typo' },
    ]
  })

  it('renders nothing when not open', () => {
    renderModal({ open: false })
    expect(screen.queryByTestId('unified-search-modal')).not.toBeInTheDocument()
  })

  it('renders tabs and search input when open', () => {
    renderModal()
    expect(screen.getByTestId('unified-search-modal')).toBeInTheDocument()
    expect(screen.getByTestId('unified-search-input')).toBeInTheDocument()
    expect(screen.getByTestId('tab-branches')).toBeInTheDocument()
    expect(screen.getByTestId('tab-prs')).toBeInTheDocument()
    expect(screen.getByTestId('tab-issues')).toBeInTheDocument()
  })

  it('shows PRs tab by default when GitHub is ready', () => {
    renderModal()
    expect(screen.getByTestId('tab-prs')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Feature: Auth')).toBeInTheDocument()
  })

  it('shows branches tab by default when GitHub is not ready', () => {
    renderModal({ githubReady: false })
    expect(screen.getByTestId('tab-branches')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(screen.getByText('develop')).toBeInTheDocument()
  })

  it('switches to Issues tab on click', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('tab-issues'))
    expect(screen.getByTestId('tab-issues')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Fix login bug')).toBeInTheDocument()
  })

  it('switches to Branches tab on click', () => {
    renderModal()
    fireEvent.click(screen.getByTestId('tab-branches'))
    expect(screen.getByTestId('tab-branches')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('forwards search query to all hooks', () => {
    renderModal()
    const input = screen.getByTestId('unified-search-input')
    fireEvent.change(input, { target: { value: 'test' } })
    expect(mockBranchSearch.setQuery).toHaveBeenCalledWith('test')
    expect(mockIssueSearch.setQuery).toHaveBeenCalledWith('test')
    expect(mockPrSearch.setQuery).toHaveBeenCalledWith('test')
  })

  it('calls onSelectBranch when a branch is clicked', () => {
    const props = renderModal()
    fireEvent.click(screen.getByTestId('tab-branches'))
    fireEvent.click(screen.getByText('develop'))
    expect(props.onSelectBranch).toHaveBeenCalledWith('develop')
    expect(props.onClose).toHaveBeenCalled()
  })

  it('calls onSelectIssue when an issue is clicked', async () => {
    const mockDetails = {
      number: 1,
      title: 'Fix login bug',
      url: 'https://github.com/test/1',
      body: 'description',
      labels: [],
      comments: [],
    }
    mockIssueSearch.fetchDetails.mockResolvedValueOnce(mockDetails)
    const props = renderModal()

    fireEvent.click(screen.getByTestId('tab-issues'))
    await act(async () => {
      fireEvent.click(screen.getByText('Fix login bug'))
    })

    await waitFor(() => {
      expect(props.onSelectIssue).toHaveBeenCalled()
    })
    const arg = (props.onSelectIssue as Mock).mock.calls[0][0] as GithubIssueSelectionResult
    expect(arg.details).toEqual(mockDetails)
    expect(arg.prompt).toBe('issue prompt')
  })

  it('calls onSelectPr when a PR is clicked', async () => {
    const mockDetails = {
      number: 10,
      title: 'Feature: Auth',
      url: 'https://github.com/test/10',
      body: 'pr body',
      labels: [],
      comments: [],
      headRefName: 'feature/auth',
      latestReviews: [],
      isFork: false,
    }
    mockPrSearch.fetchDetails.mockResolvedValueOnce(mockDetails)
    const props = renderModal()

    fireEvent.click(screen.getByTestId('tab-prs'))
    await act(async () => {
      fireEvent.click(screen.getByText('Feature: Auth'))
    })

    await waitFor(() => {
      expect(props.onSelectPr).toHaveBeenCalled()
    })
    const arg = (props.onSelectPr as Mock).mock.calls[0][0] as GithubPrSelectionResult
    expect(arg.details).toEqual(mockDetails)
    expect(arg.prompt).toBe('pr prompt')
  })

  it('calls onClose on Escape', () => {
    const props = renderModal()
    fireEvent.keyDown(screen.getByTestId('unified-search-modal'), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })

  it('disables PR/Issues tabs when GitHub is not ready', () => {
    renderModal({ githubReady: false })
    const prTab = screen.getByTestId('tab-prs')
    const issueTab = screen.getByTestId('tab-issues')
    expect(prTab).toHaveAttribute('aria-disabled', 'true')
    expect(issueTab).toHaveAttribute('aria-disabled', 'true')
  })

  it('navigates highlighted index with arrow keys', () => {
    renderModal()
    const modal = screen.getByTestId('unified-search-modal')

    fireEvent.keyDown(modal, { key: 'ArrowDown' })
    const items = screen.getAllByTestId(/^pr-item-/)
    expect(items[0]).toHaveAttribute('data-highlighted', 'true')

    fireEvent.keyDown(modal, { key: 'ArrowDown' })
    expect(items[1]).toHaveAttribute('data-highlighted', 'true')

    fireEvent.keyDown(modal, { key: 'ArrowUp' })
    expect(items[0]).toHaveAttribute('data-highlighted', 'true')
  })

  it('selects highlighted item on Enter', () => {
    const props = renderModal()
    const modal = screen.getByTestId('unified-search-modal')
    fireEvent.click(screen.getByTestId('tab-branches'))

    fireEvent.keyDown(modal, { key: 'ArrowDown' })
    fireEvent.keyDown(modal, { key: 'Enter' })

    expect(props.onSelectBranch).toHaveBeenCalledWith('main')
  })

  it('shows loading state for branches', () => {
    mockBranchSearch.loading = true
    mockBranchSearch.filteredBranches = []
    renderModal({ githubReady: false })
    expect(screen.getByTestId('unified-search-loading')).toBeInTheDocument()
  })

  it('shows empty state when no branches match', () => {
    mockBranchSearch.filteredBranches = []
    renderModal({ githubReady: false })
    expect(screen.getByText(/No branches found/i)).toBeInTheDocument()
  })

  it('resets highlighted index when switching tabs', () => {
    renderModal()
    const modal = screen.getByTestId('unified-search-modal')

    fireEvent.keyDown(modal, { key: 'ArrowDown' })
    fireEvent.keyDown(modal, { key: 'ArrowDown' })

    fireEvent.click(screen.getByTestId('tab-branches'))

    fireEvent.keyDown(modal, { key: 'ArrowDown' })
    const branchItems = screen.getAllByTestId(/^branch-item-/)
    expect(branchItems[0]).toHaveAttribute('data-highlighted', 'true')
  })

  it('cycles tabs with Tab and Shift+Tab keys', () => {
    renderModal()
    const modal = screen.getByTestId('unified-search-modal')

    expect(screen.getByTestId('tab-prs')).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(modal, { key: 'Tab' })
    expect(screen.getByTestId('tab-issues')).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(modal, { key: 'Tab' })
    expect(screen.getByTestId('tab-branches')).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(modal, { key: 'Tab' })
    expect(screen.getByTestId('tab-prs')).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(modal, { key: 'Tab', shiftKey: true })
    expect(screen.getByTestId('tab-branches')).toHaveAttribute('aria-selected', 'true')
  })
})
