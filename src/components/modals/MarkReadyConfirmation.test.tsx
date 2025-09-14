import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MarkReadyConfirmation } from './MarkReadyConfirmation'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

describe('MarkReadyConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // silence alert during tests
    ;(globalThis as { alert: typeof alert }).alert = vi.fn()
  })

  const baseProps = {
    open: true,
    sessionName: 's1',
    hasUncommittedChanges: false,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  }

  it('calls backend and closes on success (no uncommitted)', async () => {
    // First call: freshness check => false (clean)
    mockInvoke.mockResolvedValueOnce(false)
    // Second call: mark session => success
    mockInvoke.mockResolvedValueOnce(true)

    const onClose = vi.fn()
    const onSuccess = vi.fn()

    render(<MarkReadyConfirmation {...baseProps} onClose={onClose} onSuccess={onSuccess} />)

    // Wait for the loading state to resolve and show the actual dialog
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mark as Reviewed/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Mark as Reviewed/ }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreMarkSessionReady, { name: 's1', autoCommit: true })
      expect(onSuccess).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('requires auto-commit when uncommitted; toggling checkbox enables confirm', async () => {
    // First call: freshness check => true (dirty)
    mockInvoke.mockResolvedValueOnce(true)
    // Second call: mark session => success
    mockInvoke.mockResolvedValueOnce(true)

    render(<MarkReadyConfirmation {...baseProps} hasUncommittedChanges={true} />)

    // Wait for the loading state to resolve and show the actual dialog
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mark as Reviewed/ })).toBeInTheDocument()
    })

    const confirmBtn = screen.getByRole('button', { name: /Mark as Reviewed/ }) as HTMLButtonElement
    // Initially autoCommit = true => enabled
    expect(confirmBtn.disabled).toBe(false)

    // Turn off autocommit disables button
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    fireEvent.click(checkbox)
    expect(confirmBtn.disabled).toBe(true)

    // Turn it back on enables and triggers call
    fireEvent.click(checkbox)
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreMarkSessionReady, { name: 's1', autoCommit: true })
    })
  })

  it('handles keyboard Esc', async () => {
    // First call: freshness check => false
    mockInvoke.mockResolvedValueOnce(false)
    
    const onClose = vi.fn()
    render(<MarkReadyConfirmation {...baseProps} onClose={onClose} />)

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mark as Reviewed/ })).toBeInTheDocument()
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('handles keyboard Enter', async () => {
    // First call: freshness check => false
    mockInvoke.mockResolvedValueOnce(false)
    // Second call: mark session => success
    mockInvoke.mockResolvedValueOnce(true)

    render(<MarkReadyConfirmation {...baseProps} />)
    
    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Mark as Reviewed/ })).toBeInTheDocument()
    })
    
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreMarkSessionReady, { name: 's1', autoCommit: true })
    })
  })

})
