import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider, useToast } from '../ToastProvider'

vi.mock('../../../utils/clipboard', () => ({
  writeClipboard: vi.fn().mockResolvedValue(true),
}))

const { writeClipboard } = await import('../../../utils/clipboard')

function TriggerToastButton({ tone = 'error', description }: { tone?: 'success' | 'warning' | 'error' | 'info'; description?: string }) {
  const { pushToast } = useToast()
  return (
    <button
      type="button"
      onClick={() => pushToast({ tone, title: 'Something failed', description })}
    >
      Trigger toast
    </button>
  )
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('provides a copy button for error toasts that copies title and description', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <TriggerToastButton description="Stack trace: boom" />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: /trigger toast/i }))

    const copyButton = await screen.findByRole('button', { name: /copy error details/i })
    await user.click(copyButton)

    expect(writeClipboard).toHaveBeenCalledWith('Something failed\n\nStack trace: boom')
  })

  it('ensures toast stack accepts pointer interactions', () => {
    render(
      <ToastProvider>
        <span>child</span>
      </ToastProvider>
    )

    const stack = document.querySelector('[aria-live="polite"]')
    expect(stack).toHaveClass('pointer-events-auto')
    expect(stack).not.toHaveClass('pointer-events-none')
  })
})
