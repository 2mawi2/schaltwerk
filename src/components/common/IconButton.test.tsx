import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
