import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { IconButton } from './IconButton'

describe('IconButton', () => {
  it('does not set native title when tooltip is provided', () => {
    render(
      <IconButton
        icon={<span>icon</span>}
        onClick={() => {}}
        ariaLabel="Run spec"
        tooltip="Run spec"
      />
    )

    const button = screen.getByRole('button', { name: 'Run spec' })
    expect(button).not.toHaveAttribute('title')
  })

  it('falls back to aria label for native title when tooltip is missing', () => {
    render(
      <IconButton
        icon={<span>icon</span>}
        onClick={() => {}}
        ariaLabel="Run spec"
      />
    )

    const button = screen.getByRole('button', { name: 'Run spec' })
    expect(button).toHaveAttribute('title', 'Run spec')
  })

  it('renders tooltip into document.body when shown', async () => {
    vi.useFakeTimers()

    try {
      render(
        <IconButton
          icon={<span>icon</span>}
          onClick={() => {}}
          ariaLabel="Switch model"
          tooltip="Switch model"
        />
      )

      const button = screen.getByRole('button', { name: 'Switch model' })

      await act(async () => {
        fireEvent.mouseEnter(button)
        await vi.advanceTimersByTimeAsync(500)
      })

      const tooltip = document.body.querySelector('[role="tooltip"]')
      expect(tooltip).not.toBeNull()
      expect(tooltip?.parentElement).toBe(document.body)

      await act(async () => {
        fireEvent.mouseLeave(button)
        await vi.runAllTimersAsync()
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
