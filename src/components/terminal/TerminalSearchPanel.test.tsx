import { render, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { TestProviders } from '../../tests/test-utils'
import { TerminalSearchPanel } from './TerminalSearchPanel'

describe('TerminalSearchPanel', () => {
  const setup = async () => {
    const onChange = vi.fn()
    const onNext = vi.fn()
    const onPrev = vi.fn()
    const onClose = vi.fn()

    let result: ReturnType<typeof render> | null = null
    await act(async () => {
      result = render(
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
    })

    const input = result!.getByPlaceholderText('Search...') as HTMLInputElement

    return { result: result!, input, onChange, onNext, onPrev, onClose }
  }

  it('calls callbacks for input change and navigation actions', async () => {
    const { input, onChange, onNext, onPrev } = await setup()

    act(() => {
      fireEvent.change(input, { target: { value: 'hello' } })
    })
    expect(onChange).toHaveBeenCalledWith('hello')

    act(() => {
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: false })
    })
    expect(onNext).toHaveBeenCalled()

    act(() => {
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    })
    expect(onPrev).toHaveBeenCalled()
  })

  it('closes on escape and via close button', async () => {
    const { input, onClose, result } = await setup()

    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' })
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    const button = result.getByTitle('Close search (Escape)')
    act(() => {
      fireEvent.click(button)
    })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('forwards refs to the search container', async () => {
    const ref = createRef<HTMLDivElement>()

    await act(async () => {
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
    })

    expect(ref.current).toBeInstanceOf(HTMLDivElement)
    expect(ref.current?.dataset.terminalSearch).toBe('true')
  })
})
