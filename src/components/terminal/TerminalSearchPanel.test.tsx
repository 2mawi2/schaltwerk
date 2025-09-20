import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { TestProviders } from '../../tests/test-utils'
import { TerminalSearchPanel } from './TerminalSearchPanel'

describe('TerminalSearchPanel', () => {
  const setup = () => {
    const onChange = vi.fn()
    const onNext = vi.fn()
    const onPrev = vi.fn()
    const onClose = vi.fn()

    const result = render(
      <TestProviders>
        <TerminalSearchPanel
          searchTerm="abc"
          onSearchTermChange={onChange}
          onFindNext={onNext}
          onFindPrevious={onPrev}
          onClose={onClose}
        />
      </TestProviders>
    )

    const input = result.getByPlaceholderText('Search...') as HTMLInputElement

    return { result, input, onChange, onNext, onPrev, onClose }
  }

  it('calls callbacks for input change and navigation actions', () => {
    const { input, onChange, onNext, onPrev } = setup()

    fireEvent.change(input, { target: { value: 'hello' } })
    expect(onChange).toHaveBeenCalledWith('hello')

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false })
    expect(onNext).toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onPrev).toHaveBeenCalled()
  })

  it('closes on escape and via close button', () => {
    const { input, onClose, result } = setup()

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    const button = result.getByTitle('Close search (Escape)')
    fireEvent.click(button)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('forwards refs to the search container', () => {
    const ref = createRef<HTMLDivElement>()

    render(
      <TestProviders>
        <TerminalSearchPanel
          ref={ref}
          searchTerm=""
          onSearchTermChange={() => {}}
          onFindNext={() => {}}
          onFindPrevious={() => {}}
          onClose={() => {}}
        />
      </TestProviders>
    )

    expect(ref.current).toBeInstanceOf(HTMLDivElement)
    expect(ref.current?.dataset.terminalSearch).toBe('true')
  })
})
