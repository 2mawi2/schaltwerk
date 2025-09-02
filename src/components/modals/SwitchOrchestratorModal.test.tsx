import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { SwitchOrchestratorModal } from './SwitchOrchestratorModal'

// Mock useClaudeSession to control getAgentType behavior and avoid tauri calls
vi.mock('../../hooks/useClaudeSession', () => {
  return {
    useClaudeSession: () => ({
      getAgentType: vi.fn().mockResolvedValue('cursor'),
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
  })

  afterEach(() => {
    cleanup()
  })

  it('renders nothing when closed, shows content when open', async () => {
    const { rerender } = render(
      <SwitchOrchestratorModal open={false} onClose={vi.fn()} onSwitch={vi.fn()} />
    )
    expect(screen.queryByText('Switch Orchestrator Agent')).not.toBeInTheDocument()

    await act(async () => {
      rerender(<SwitchOrchestratorModal open={true} onClose={vi.fn()} onSwitch={vi.fn()} />)
    })
    expect(screen.getByText('Switch Orchestrator Agent')).toBeInTheDocument()
  })

  it('loads current agent type on open and displays it', async () => {
    openModal()
    // Wait until ModelSelector button reflects the loaded agent type
    await waitFor(() => expect(screen.getByRole('button', { name: /cursor/i })).toBeInTheDocument())
  })

  it('calls onSwitch with the currently selected agent type', async () => {
    const { onSwitch } = openModal()

    // Wait for agent type to load to "Cursor"
    await waitFor(() => screen.getByRole('button', { name: /cursor/i }))

    // Click Switch Agent -> should call with 'cursor'
    fireEvent.click(screen.getByRole('button', { name: /switch agent/i }))
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith('cursor'))

    // Change selection to Claude via dropdown and switch again
    const selectorButton = screen.getByRole('button', { name: /cursor/i })
    fireEvent.click(selectorButton)
    const claudeOption = await screen.findByRole('button', { name: /^claude$/i })
    fireEvent.click(claudeOption)

    fireEvent.click(screen.getByRole('button', { name: /switch agent/i }))
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith('claude'))
  })

  it('switches model on click (success path)', async () => {
    const slowResolve = vi.fn().mockImplementation(
      () => new Promise<void>(resolve => setTimeout(resolve, 50))
    )
    openModal({ onSwitch: slowResolve })
    await waitFor(() => screen.getByRole('button', { name: /cursor/i }))
    const switchBtn = screen.getByRole('button', { name: /switch agent/i }) as HTMLButtonElement
    fireEvent.click(switchBtn)
    await waitFor(() => expect(slowResolve).toHaveBeenCalledTimes(1))
  })

  // Note: component does not synchronously guard against double submit due to async state update

  it('re-enables controls after switch failure', async () => {
    const rejectOnce = vi.fn().mockImplementation(
      () => new Promise<void>((_r, rej) => setTimeout(() => rej(new Error('boom')), 10))
    )
    openModal({ onSwitch: rejectOnce })
    // Wait for initial load before triggering switch
    await waitFor(() => screen.getByRole('button', { name: /cursor/i }))

    const switchBtn = screen.getByRole('button', { name: /switch agent/i }) as HTMLButtonElement

    // Avoid unhandled rejection noise & wrap expectations to complete before rejection bubbles
    const handler = (e: PromiseRejectionEvent) => {
      e.preventDefault()
    }
    window.addEventListener('unhandledrejection', handler)
    try {
      await act(async () => {
        fireEvent.click(switchBtn)
      })

      // Wait until first failure processed
      await waitFor(() => expect(rejectOnce).toHaveBeenCalledTimes(1))

      // Can retry switching again after failure
      await act(async () => {
        fireEvent.click(switchBtn)
      })
      await waitFor(() => expect(rejectOnce).toHaveBeenCalledTimes(2))
    } finally {
      window.removeEventListener('unhandledrejection', handler)
    }
  })

  it('keyboard: Escape closes modal, Enter triggers switch', async () => {
    const { onClose } = openModal()

    // Wait until ready
    await waitFor(() => screen.getByText('Switch Orchestrator Agent'))

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
    await waitFor(() => screen.getByText('Switch Orchestrator Agent'))

    const enter = new KeyboardEvent('keydown', { key: 'Enter' })
    await act(async () => {
      window.dispatchEvent(enter)
    })
    await waitFor(() => expect(onSwitch2).toHaveBeenCalled())
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
