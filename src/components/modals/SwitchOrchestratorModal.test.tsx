import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SwitchOrchestratorModal } from './SwitchOrchestratorModal'

const mockGetOrchestratorAgentType = vi.fn().mockResolvedValue('opencode')
const mockGetOrchestratorSkipPermissions = vi.fn().mockResolvedValue(false)
const mockGetAgentType = vi.fn().mockResolvedValue('claude')
const mockGetSkipPermissions = vi.fn().mockResolvedValue(false)

// Mock useClaudeSession to control behavior and avoid tauri calls
vi.mock('../../hooks/useClaudeSession', () => {
  return {
    useClaudeSession: () => ({
      getOrchestratorAgentType: mockGetOrchestratorAgentType,
      getOrchestratorSkipPermissions: mockGetOrchestratorSkipPermissions,
      getAgentType: mockGetAgentType,
      getSkipPermissions: mockGetSkipPermissions,
    }),
  }
})

// Mock useAgentAvailability to make all agents available in tests
vi.mock('../../hooks/useAgentAvailability', () => ({
  useAgentAvailability: () => ({
    isAvailable: vi.fn().mockReturnValue(true),
    getRecommendedPath: vi.fn().mockReturnValue('/usr/local/bin/agent'),
    getInstallationMethod: vi.fn().mockReturnValue('Homebrew'),
    loading: false,
    availability: {},
    refreshAvailability: vi.fn(),
    refreshSingleAgent: vi.fn(),
    clearCache: vi.fn(),
    forceRefresh: vi.fn(),
  }),
  InstallationMethod: {
    Homebrew: 'Homebrew',
    Npm: 'Npm',
    Pip: 'Pip',
    Manual: 'Manual',
    System: 'System',
  }
}))

function openModal(overrides: Partial<React.ComponentProps<typeof SwitchOrchestratorModal>> = {}) {
  const onClose = vi.fn()
  const onSwitch = vi.fn().mockResolvedValue(undefined)
  render(
    <SwitchOrchestratorModal open={true} onClose={onClose} onSwitch={onSwitch} {...overrides} />
  )
  return { onClose, onSwitch }
}

describe('SwitchOrchestratorModal', () => {
  let prevUnhandled: OnErrorEventHandler
  const noop = () => {}
  beforeAll(() => {
    prevUnhandled = (window as Window & { onunhandledrejection: OnErrorEventHandler }).onunhandledrejection
    ;(window as Window & { onunhandledrejection: (e: PromiseRejectionEvent) => void }).onunhandledrejection = (e: PromiseRejectionEvent) => {
      e.preventDefault()
    }
    // Also suppress Node-level unhandled rejections during this suite
    process.on('unhandledRejection', noop)
  })
  afterAll(() => {
    (window as Window & { onunhandledrejection: OnErrorEventHandler }).onunhandledrejection = prevUnhandled
    process.off('unhandledRejection', noop)
  })
  beforeEach(() => {
    vi.useRealTimers()
    mockGetOrchestratorAgentType.mockResolvedValue('opencode')
    mockGetOrchestratorSkipPermissions.mockResolvedValue(false)
    mockGetAgentType.mockResolvedValue('claude')
    mockGetSkipPermissions.mockResolvedValue(false)
  })

  afterEach(() => {
    cleanup()
    mockGetOrchestratorAgentType.mockClear()
    mockGetOrchestratorSkipPermissions.mockClear()
    mockGetAgentType.mockClear()
    mockGetSkipPermissions.mockClear()
  })

  it('renders nothing when closed, shows content when open', async () => {
    const { rerender } = render(
      <SwitchOrchestratorModal open={false} onClose={vi.fn()} onSwitch={vi.fn()} />
    )
    expect(screen.queryByText('Switch Orchestrator Agent')).not.toBeInTheDocument()

    await act(async () => {
      rerender(<SwitchOrchestratorModal open={true} onClose={vi.fn()} onSwitch={vi.fn()} />)
    })
    expect(screen.getByRole('heading', { name: 'Switch Orchestrator Agent' })).toBeInTheDocument()
  })

  it('loads current agent type on open and displays it', async () => {
    openModal()
    // Wait until ModelSelector button reflects the loaded agent type
    await waitFor(() => expect(screen.getByRole('button', { name: /opencode/i })).toBeInTheDocument())
  })

  it('calls onSwitch with the currently selected agent type', async () => {
    const { onSwitch } = openModal()
    const user = userEvent.setup()

    // Wait for agent type to load to "OpenCode"
    await waitFor(() => screen.getByRole('button', { name: /claude/i }))

    // Click Switch Agent -> should call with 'opencode'
    await user.click(screen.getByRole('button', { name: /switch agent/i }))
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith({ agentType: 'opencode', skipPermissions: false }))

    // Change selection to Claude via dropdown and switch again
    const selectorButton = screen.getByRole('button', { name: /opencode/i })
    await user.click(selectorButton)

    // Wait for dropdown to appear and contain Claude option
    const claudeOption = await screen.findByRole('button', { name: /Claude/i })
    await user.click(claudeOption)

    await user.click(screen.getByRole('button', { name: /switch agent/i }))
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith({ agentType: 'claude', skipPermissions: false }))
  })

  it('exposes permission controls for agents that support skipping permissions', async () => {
    mockGetOrchestratorAgentType.mockResolvedValue('claude')
    mockGetOrchestratorSkipPermissions.mockResolvedValue(true)

    const { onSwitch } = openModal()

    await waitFor(() => screen.getByRole('button', { name: /claude/i }))

    const skipButton = await screen.findByRole('button', { name: /Skip permissions/i })
    const requireButton = await screen.findByRole('button', { name: /Require permissions/i })

    expect(skipButton).toHaveAttribute('aria-pressed', 'true')
    expect(requireButton).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(requireButton)

    fireEvent.click(screen.getByRole('button', { name: /switch agent/i }))

    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith({ agentType: 'claude', skipPermissions: false }))
  })

  it('hides permission controls for agents without support', async () => {
    mockGetOrchestratorAgentType.mockResolvedValue('claude')
    openModal()

    await waitFor(() => screen.getByRole('button', { name: /claude/i }))
    await userEvent.click(screen.getByRole('button', { name: /claude/i }))
    await userEvent.click(screen.getByRole('button', { name: 'OpenCode' }))

    expect(screen.queryByRole('button', { name: /Skip permissions/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Require permissions/i })).not.toBeInTheDocument()
  })

  it('switches model on click (success path)', async () => {
    const slowResolve = vi.fn().mockImplementation(async () => {
      await Promise.resolve()
    })
    openModal({ onSwitch: slowResolve })
    await waitFor(() => screen.getByRole('button', { name: /opencode/i }))
    const switchBtn = screen.getByRole('button', { name: /switch agent/i }) as HTMLButtonElement

    fireEvent.click(switchBtn)
    await waitFor(() => expect(slowResolve).toHaveBeenCalledTimes(1))
  })

  // Note: component does not synchronously guard against double submit due to async state update

  it('re-enables controls after switch failure', async () => {
    const rejectOnce = vi.fn().mockImplementation(async () => {
      await Promise.resolve()
      throw new Error('boom')
    })
    openModal({ onSwitch: rejectOnce })
    // Wait for initial load before triggering switch
    await waitFor(() => screen.getByRole('button', { name: /opencode/i }))

    const switchBtn = screen.getByRole('button', { name: /switch agent/i }) as HTMLButtonElement

    // Avoid unhandled rejection noise & wrap expectations to complete before rejection bubbles
    const handler = (e: PromiseRejectionEvent) => {
      e.preventDefault()
    }
    window.addEventListener('unhandledrejection', handler)
    try {
      fireEvent.click(switchBtn)
      await waitFor(() => expect(rejectOnce).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(switchBtn).not.toBeDisabled())

      // Can retry switching again after failure
      fireEvent.click(switchBtn)
      await waitFor(() => expect(rejectOnce).toHaveBeenCalledTimes(2))
    } finally {
      window.removeEventListener('unhandledrejection', handler)
    }
  })

  it('does not offer the terminal-only agent for orchestrator', async () => {
    openModal()
    await waitFor(() => screen.getByRole('button', { name: /opencode/i }))
    await userEvent.click(screen.getByRole('button', { name: /opencode/i }))

    expect(screen.queryByRole('button', { name: /Terminal Only/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /terminal/i })).not.toBeInTheDocument()
  })

  it('uses session-specific configuration when scope=session', async () => {
    mockGetAgentType.mockResolvedValue('opencode')
    const { onSwitch } = openModal({ scope: 'session' })

    await waitFor(() => expect(mockGetAgentType).toHaveBeenCalled())
    await waitFor(() => screen.getByRole('button', { name: /opencode/i }))

    expect(screen.getByText('Switch Session Agent')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: /terminal/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /switch agent/i }))
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith({ agentType: 'opencode', skipPermissions: false }))
  })

  it('keyboard: Escape closes modal, Enter triggers switch, and respects open dropdown', async () => {
    const { onClose } = openModal()

    // Wait until ready
    await waitFor(() => screen.getByRole('heading', { name: 'Switch Orchestrator Agent' }))

    // Esc closes
    const esc = new KeyboardEvent('keydown', { key: 'Escape' })
    await act(async () => {
      window.dispatchEvent(esc)
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())

    // Re-open to test Enter
    cleanup()
    const onClose2 = vi.fn()
    const onSwitch2 = vi.fn().mockResolvedValue(undefined)
    render(<SwitchOrchestratorModal open={true} onClose={onClose2} onSwitch={onSwitch2} />)
    await waitFor(() => screen.getByRole('heading', { name: 'Switch Orchestrator Agent' }))

    const enter = new KeyboardEvent('keydown', { key: 'Enter' })
    await act(async () => {
      window.dispatchEvent(enter)
    })
    await waitFor(() => expect(onSwitch2).toHaveBeenCalled())

    // Re-open to ensure Enter is ignored while dropdown is open
    cleanup()
    const onClose3 = vi.fn()
    const onSwitch3 = vi.fn().mockResolvedValue(undefined)
    render(<SwitchOrchestratorModal open={true} onClose={onClose3} onSwitch={onSwitch3} />)

    await waitFor(() => screen.getByRole('button', { name: /opencode/i }))

    await userEvent.click(screen.getByRole('button', { name: /opencode/i }))

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    })

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })

    await waitFor(() => screen.getByRole('button', { name: /gemini/i }))
    expect(onSwitch3).not.toHaveBeenCalled()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })

    await waitFor(() => expect(onSwitch3).toHaveBeenCalledWith({ agentType: 'gemini', skipPermissions: false }))
  })

  it('cancel button closes the modal', async () => {
    const { onClose } = openModal()
    const cancelBtn = await screen.findByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows a warning block but no additional confirmation dialog', async () => {
    openModal()
    await waitFor(() => screen.getByText('Warning'))
    expect(screen.getByText('Warning')).toBeInTheDocument()
    // There is no separate confirmation dialog opened by this component
    expect(screen.queryByText(/are you sure/i)).not.toBeInTheDocument()
  })
})
