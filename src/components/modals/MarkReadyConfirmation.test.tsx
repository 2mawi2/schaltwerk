import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MarkReadyConfirmation } from './MarkReadyConfirmation'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
import { invoke } from '@tauri-apps/api/core'
const mockInvoke = vi.mocked(invoke)

describe('MarkReadyConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // silence alert during tests
    ;(globalThis as any).alert = vi.fn()
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

    fireEvent.click(screen.getByRole('button', { name: /Mark as Reviewed/ }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('para_core_mark_session_ready', { name: 's1', autoCommit: true })
      expect(onSuccess).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('requires auto-commit when uncommitted; toggling checkbox enables confirm', async () => {
    // Freshness check => true (dirty)
    mockInvoke.mockResolvedValueOnce(true)
    // Mark session => success
    mockInvoke.mockResolvedValueOnce(true)

    render(<MarkReadyConfirmation {...baseProps} hasUncommittedChanges={true} />)

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
      expect(mockInvoke).toHaveBeenCalledWith('para_core_mark_session_ready', { name: 's1', autoCommit: true })
    })
  })

  it('handles keyboard Esc and Enter', async () => {
    // Freshness check => false
    mockInvoke.mockResolvedValueOnce(false)
    // Mark session => success
    mockInvoke.mockResolvedValueOnce(true)
    const onClose = vi.fn()
    render(<MarkReadyConfirmation {...baseProps} onClose={onClose} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalled()

    render(<MarkReadyConfirmation {...baseProps} />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('para_core_mark_session_ready', { name: 's1', autoCommit: true })
    })
  })
})
