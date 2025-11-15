import { render, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TestProviders } from '../../tests/test-utils'
import { TerminalLoadingOverlay } from './TerminalLoadingOverlay'

describe('TerminalLoadingOverlay', () => {
  it('renders nothing when not visible', async () => {
    let utils: ReturnType<typeof render> | undefined
    await act(async () => {
      utils = render(
        <TestProviders>
          <TerminalLoadingOverlay visible={false} />
        </TestProviders>
      )
    })

    expect(utils!.container.firstChild).toBeNull()
  })

  it('shows the loading indicator when visible', async () => {
    let utils: ReturnType<typeof render> | undefined
    await act(async () => {
      utils = render(
        <TestProviders>
          <TerminalLoadingOverlay visible />
        </TestProviders>
      )
    })

    expect(utils!.getByRole('img')).toBeInTheDocument()
  })
})
