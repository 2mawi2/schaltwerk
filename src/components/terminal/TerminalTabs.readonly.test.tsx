import { forwardRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TerminalTabs } from './TerminalTabs'

let mockedActiveTab = 0

vi.mock('../../hooks/useTerminalTabs', () => ({
  useTerminalTabs: () => ({
    tabs: [
      { index: 0, terminalId: 'session-demo-bottom', label: 'Terminal 1' },
      { index: 1, terminalId: 'session-demo-bottom-1', label: 'Terminal 2' },
    ],
    activeTab: mockedActiveTab,
    canAddTab: true,
    addTab: vi.fn(),
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    reorderTabs: vi.fn(),
  }),
}))

vi.mock('../../contexts/ModalContext', () => ({
  useModal: () => ({ isAnyModalOpen: () => false }),
}))

vi.mock('./Terminal', async () => {
  type TerminalProps = {
    terminalId: string
    readOnly?: boolean
  }
  return {
    Terminal: forwardRef((_props: TerminalProps, _ref) => {
      const props = _props as TerminalProps
      return (
        <div
          data-testid={`terminal-${props.terminalId}`}
          data-readonly={props.readOnly ? 'true' : 'false'}
        />
      )
    }),
  }
})

describe('TerminalTabs', () => {
  it('marks inactive terminals as readOnly so input is not broadcast across tabs', () => {
    mockedActiveTab = 0
    const { rerender } = render(
      <TerminalTabs
        headless={true}
        baseTerminalId="session-demo-bottom"
        workingDirectory="/tmp"
        projectPath={null}
        className="initial"
      />,
    )

    expect(screen.getByTestId('terminal-session-demo-bottom')).toHaveAttribute('data-readonly', 'false')
    expect(screen.getByTestId('terminal-session-demo-bottom-1')).toHaveAttribute('data-readonly', 'true')

    mockedActiveTab = 1
    rerender(
      <TerminalTabs
        headless={true}
        baseTerminalId="session-demo-bottom"
        workingDirectory="/tmp"
        projectPath={null}
        className="rerender"
      />,
    )

    expect(screen.getByTestId('terminal-session-demo-bottom')).toHaveAttribute('data-readonly', 'true')
    expect(screen.getByTestId('terminal-session-demo-bottom-1')).toHaveAttribute('data-readonly', 'false')
  })
})
