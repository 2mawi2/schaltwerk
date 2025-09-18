import { render, screen, waitFor } from '@testing-library/react'
import { BranchIndicator } from '../BranchIndicator'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

const mockedInvoke = vi.mocked(invoke)

describe('BranchIndicator', () => {
  beforeEach(() => {
    mockedInvoke.mockReset()
  })

  test('shows session and branch details in development builds', async () => {
    mockedInvoke.mockResolvedValue({
      isDevelopment: true,
      isWorktree: true,
      sessionName: 'focused_carson',
      branch: 'schaltwerk/focused_carson'
    })

    render(<BranchIndicator />)

    await waitFor(() => {
      expect(screen.getByTestId('branch-indicator')).toBeInTheDocument()
    })

    expect(screen.getByTestId('branch-indicator-session')).toHaveTextContent('focused_carson')
    expect(screen.getByTestId('branch-indicator-branch')).toHaveTextContent('schaltwerk/focused_carson')
  })

  test('hides indicator when session information is missing in release builds', async () => {
    mockedInvoke.mockResolvedValue({
      isDevelopment: false,
      isWorktree: true,
      sessionName: 'focused_carson',
      branch: 'schaltwerk/focused_carson'
    })

    render(<BranchIndicator />)

    await waitFor(() => {
      expect(screen.queryByTestId('branch-indicator')).not.toBeInTheDocument()
    })
  })

  test('omits session label when session information is not provided', async () => {
    mockedInvoke.mockResolvedValue({
      isDevelopment: true,
      isWorktree: false,
      sessionName: null,
      branch: 'main'
    })

    render(<BranchIndicator />)

    await waitFor(() => {
      expect(screen.getByTestId('branch-indicator')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('branch-indicator-session')).not.toBeInTheDocument()
    expect(screen.getByTestId('branch-indicator-branch')).toHaveTextContent('main')
  })

  test('hides indicator when no branch information is available', async () => {
    mockedInvoke.mockResolvedValue({
      isDevelopment: true,
      isWorktree: true,
      sessionName: 'focused_carson',
      branch: null
    })

    render(<BranchIndicator />)

    await waitFor(() => {
      expect(screen.queryByTestId('branch-indicator')).not.toBeInTheDocument()
    })
  })
})
