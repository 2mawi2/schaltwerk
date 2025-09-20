import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TestProviders } from '../../tests/test-utils'
import { TerminalLoadingOverlay } from './TerminalLoadingOverlay'

describe('TerminalLoadingOverlay', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(
      <TestProviders>
        <TerminalLoadingOverlay visible={false} />
      </TestProviders>
    )

    expect(container.firstChild).toBeNull()
  })

  it('shows the loading indicator when visible', () => {
    const { getByRole } = render(
      <TestProviders>
        <TerminalLoadingOverlay visible />
      </TestProviders>
    )

    expect(getByRole('img')).toBeInTheDocument()
  })
})
