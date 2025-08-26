import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import { FontSizeProvider, useFontSize } from './FontSizeContext'

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string, _args?: any) => {
    if (cmd === 'schaltwerk_core_get_font_sizes') {
      return Promise.resolve([13, 12])
    }
    if (cmd === 'schaltwerk_core_set_font_sizes') {
      return Promise.resolve()
    }
    return Promise.reject(new Error(`Unknown command: ${cmd}`))
  })
}))

const TestComponent = () => {
  const { terminalFontSize, uiFontSize, setTerminalFontSize, setUiFontSize, increaseFontSizes, decreaseFontSizes, resetFontSizes } = useFontSize()
  return (
    <div>
      <div data-testid="terminal-font-size">{terminalFontSize}</div>
      <div data-testid="ui-font-size">{uiFontSize}</div>
      <button onClick={increaseFontSizes} data-testid="increase">+</button>
      <button onClick={decreaseFontSizes} data-testid="decrease">-</button>
      <button onClick={resetFontSizes} data-testid="reset">Reset</button>
      <button onClick={() => setTerminalFontSize(15)} data-testid="set-terminal">Set Terminal</button>
      <button onClick={() => setUiFontSize(14)} data-testid="set-ui">Set UI</button>
    </div>
  )
}

describe('FontSizeContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('provides default font sizes', async () => {
    const { getByTestId } = render(
      <FontSizeProvider>
        <TestComponent />
      </FontSizeProvider>
    )

    await waitFor(() => {
      expect(getByTestId('terminal-font-size')).toHaveTextContent('13')
      expect(getByTestId('ui-font-size')).toHaveTextContent('12')
    })
  })

  it('increases font sizes when increase function is called', () => {
    const { getByTestId } = render(
      <FontSizeProvider>
        <TestComponent />
      </FontSizeProvider>
    )

    act(() => {
      getByTestId('increase').click()
    })

    expect(getByTestId('terminal-font-size')).toHaveTextContent('14')
    expect(getByTestId('ui-font-size')).toHaveTextContent('13')
  })

  it('decreases font sizes when decrease function is called', () => {
    const { getByTestId } = render(
      <FontSizeProvider>
        <TestComponent />
      </FontSizeProvider>
    )

    act(() => {
      getByTestId('decrease').click()
    })

    expect(getByTestId('terminal-font-size')).toHaveTextContent('12')
    expect(getByTestId('ui-font-size')).toHaveTextContent('11')
  })

  it('resets font sizes when reset function is called', () => {
    const { getByTestId } = render(
      <FontSizeProvider>
        <TestComponent />
      </FontSizeProvider>
    )

    act(() => {
      getByTestId('increase').click()
      getByTestId('increase').click()
    })

    expect(getByTestId('terminal-font-size')).toHaveTextContent('15')
    expect(getByTestId('ui-font-size')).toHaveTextContent('14')

    act(() => {
      getByTestId('reset').click()
    })

    expect(getByTestId('terminal-font-size')).toHaveTextContent('13')
    expect(getByTestId('ui-font-size')).toHaveTextContent('12')
  })

  it('persists font sizes to database', async () => {
    const mockInvoke = vi.mocked((await import('@tauri-apps/api/core')).invoke)
    
    const { getByTestId } = render(
      <FontSizeProvider>
        <TestComponent />
      </FontSizeProvider>
    )

    await waitFor(() => {
      expect(getByTestId('terminal-font-size')).toHaveTextContent('13')
    })

    act(() => {
      getByTestId('increase').click()
    })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_set_font_sizes', { 
        terminalFontSize: 14,
        uiFontSize: 13
      })
    })
  })

  it('respects min and max font size limits', () => {
    const { getByTestId } = render(
      <FontSizeProvider>
        <TestComponent />
      </FontSizeProvider>
    )

    // Test minimum limit
    for (let i = 0; i < 10; i++) {
      act(() => {
        getByTestId('decrease').click()
      })
    }
    expect(getByTestId('terminal-font-size')).toHaveTextContent('8')
    expect(getByTestId('ui-font-size')).toHaveTextContent('8')

    // Reset and test maximum limit
    act(() => {
      getByTestId('reset').click()
    })

    for (let i = 0; i < 20; i++) {
      act(() => {
        getByTestId('increase').click()
      })
    }
    expect(getByTestId('terminal-font-size')).toHaveTextContent('24')
    expect(getByTestId('ui-font-size')).toHaveTextContent('24')
  })

  it('allows setting individual font sizes', () => {
    const { getByTestId } = render(
      <FontSizeProvider>
        <TestComponent />
      </FontSizeProvider>
    )

    act(() => {
      getByTestId('set-terminal').click()
    })
    expect(getByTestId('terminal-font-size')).toHaveTextContent('15')
    expect(getByTestId('ui-font-size')).toHaveTextContent('12')

    act(() => {
      getByTestId('set-ui').click()
    })
    expect(getByTestId('terminal-font-size')).toHaveTextContent('15')
    expect(getByTestId('ui-font-size')).toHaveTextContent('14')
  })
})