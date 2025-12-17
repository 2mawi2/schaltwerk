import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { TerminalGrid } from './TerminalGrid'
import { TestProviders } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import { UiEvent, emitUiEvent } from '../../common/uiEvents'
import type { MockTauriInvokeArgs } from '../../types/testing'

const pushToastMock = vi.fn()
const dismissToastMock = vi.fn()

vi.mock('../../common/toast/ToastProvider', async () => {
  const actual = await vi.importActual<typeof import('../../common/toast/ToastProvider')>('../../common/toast/ToastProvider')
  return {
    ...actual,
    useToast: () => ({ pushToast: pushToastMock, dismissToast: dismissToastMock }),
    useOptionalToast: () => ({ pushToast: pushToastMock, dismissToast: dismissToastMock })
  }
})

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  UnlistenFn: vi.fn()
}))

const focusSpies = new Map<string, ReturnType<typeof vi.fn>>()
const orchestratorTerminalIdRef: { current: string | null } = { current: null }

vi.mock('./Terminal', () => {
  const TerminalMock = forwardRef<
    { focus: ReturnType<typeof vi.fn>; showSearch: ReturnType<typeof vi.fn>; scrollToBottom: ReturnType<typeof vi.fn> },
    { terminalId: string; isCommander?: boolean }
  >(function TerminalMock(props, ref) {
    const { terminalId, isCommander } = props
    const focusSpyRef = useRef<ReturnType<typeof vi.fn> | null>(null)
    if (!focusSpyRef.current) {
      focusSpyRef.current = vi.fn()
    }

    useImperativeHandle(ref, () => ({
      focus: focusSpyRef.current!,
      showSearch: vi.fn(),
      scrollToBottom: vi.fn(),
    }), [])

    useEffect(() => {
      focusSpies.set(terminalId, focusSpyRef.current!)
      if (isCommander) {
        orchestratorTerminalIdRef.current = terminalId
      }
      return () => {
        focusSpies.delete(terminalId)
        if (orchestratorTerminalIdRef.current === terminalId) {
          orchestratorTerminalIdRef.current = null
        }
      }
    }, [terminalId, isCommander])

    return <div data-testid={`terminal-${terminalId}`} />
  })

  function __getFocusSpy(id: string) {
    return focusSpies.get(id)
  }

  return { Terminal: TerminalMock, __getFocusSpy }
})

vi.mock('./TerminalTabs', () => ({
  TerminalTabs: ({ baseTerminalId }: { baseTerminalId: string }) => (
    <div data-testid={`terminal-tabs-${baseTerminalId}`} />
  )
}))

vi.mock('./RunTerminal', () => ({
  RunTerminal: ({ sessionName }: { sessionName?: string }) => (
    <div data-testid={`run-terminal-${sessionName ?? 'orchestrator'}`} />
  )
}))

const mockedInvoke = vi.fn<(command: string, args?: MockTauriInvokeArgs) => Promise<unknown>>()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: MockTauriInvokeArgs) => mockedInvoke(command, args)
}))

describe('TerminalGrid InsertTerminalText handling', () => {
  const writeCalls: Array<{ id: string; data: string }> = []
  let terminalExists = true

  beforeEach(() => {
    vi.clearAllMocks()
    focusSpies.clear()
    orchestratorTerminalIdRef.current = null
    writeCalls.length = 0
    terminalExists = true
    pushToastMock.mockReset()
    dismissToastMock.mockReset()

    mockedInvoke.mockImplementation(async (command: string, args?: MockTauriInvokeArgs) => {
      switch (command) {
        case TauriCommands.SchaltwerkCoreListEnrichedSessions:
          return []
        case TauriCommands.SchaltwerkCoreListSessionsByState:
          return []
        case TauriCommands.GetProjectSessionsSettings:
          return { filter_mode: 'all', sort_mode: 'name' }
        case TauriCommands.SetProjectSessionsSettings:
          return undefined
        case TauriCommands.GetProjectActionButtons:
          return []
        case TauriCommands.GetCurrentDirectory:
          return '/test/project'
        case TauriCommands.TerminalExists:
          return terminalExists
        case TauriCommands.CreateTerminal:
        case TauriCommands.CreateTerminalWithSize:
        case TauriCommands.CloseTerminal:
        case TauriCommands.ResizeTerminal:
        case TauriCommands.SchaltwerkCoreUpdateSpecContent:
        case TauriCommands.SchaltwerkCoreArchiveSpecSession:
          return undefined
        case TauriCommands.SchaltwerkCoreGetFontSizes:
          return [13, 14]
        case TauriCommands.WriteTerminal: {
          const payload = args as { id: string; data: string }
          writeCalls.push({ id: payload.id, data: payload.data })
          return undefined
        }
        default:
          return undefined
      }
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it('writes text to orchestrator terminal and focuses it when event fires', async () => {
    render(
      <TestProviders>
        <TerminalGrid />
      </TestProviders>
    )

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-tabs-/)).not.toHaveLength(0)
    })

    act(() => {
      emitUiEvent(UiEvent.InsertTerminalText, { text: 'Refine spec: Auth System (alpha)' })
    })

    await waitFor(() => {
      expect(writeCalls).toHaveLength(2)
    })

    const [clearCall, textCall] = writeCalls

    expect(clearCall.data).toBe('')
    expect(textCall.data).toBe('Refine spec: Auth System (alpha) ')

    const focusSpy = textCall ? focusSpies.get(textCall.id) : undefined
    expect(focusSpy).toBeDefined()
    expect(focusSpy).toHaveBeenCalled()
    expect(pushToastMock).not.toHaveBeenCalled()
  })

  it('shows toast when orchestrator terminal is unavailable', async () => {
    terminalExists = false

    render(
      <TestProviders>
        <TerminalGrid />
      </TestProviders>
    )

    await waitFor(() => {
      expect(screen.getAllByTestId(/terminal-tabs-/)).not.toHaveLength(0)
    })

    act(() => {
      emitUiEvent(UiEvent.InsertTerminalText, { text: 'Refine spec: Missing (beta)' })
    })

    await waitFor(() => {
      expect(pushToastMock).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }))
    })

    expect(writeCalls).toHaveLength(0)
  })
})
