import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Selection } from '../contexts/SelectionContext'
import { useSelectionPreserver } from './useSelectionPreserver'

vi.mock('../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn()
  }
}))

let selectionState: Selection = { kind: 'session', payload: 'alpha', worktreePath: '/tmp/alpha' }
const setSelectionMock = vi.fn(async () => {})

vi.mock('../contexts/SelectionContext', () => ({
  useSelection: () => ({
    selection: selectionState,
    setSelection: setSelectionMock,
    clearTerminalTracking: vi.fn(),
    terminals: { top: 't', bottomBase: 'b', workingDirectory: '/tmp' },
    isReady: true,
    isSpec: false
  })
}))

describe('useSelectionPreserver', () => {
  beforeEach(() => {
    selectionState = { kind: 'session', payload: 'alpha', worktreePath: '/tmp/alpha' }
    setSelectionMock.mockClear()
  })

  it('restores previous selection when selection changes during action', async () => {
    const { result, rerender } = renderHook(() => useSelectionPreserver())

    await act(async () => {
      await result.current(async () => {
        selectionState.payload = 'beta'
        selectionState.worktreePath = '/tmp/beta'
        rerender()
      })
    })

    expect(setSelectionMock).toHaveBeenCalledTimes(1)
    expect(setSelectionMock).toHaveBeenCalledWith(
      { kind: 'session', payload: 'alpha', worktreePath: '/tmp/alpha' },
      false,
      false
    )
  })

  it('does not restore when selection remains unchanged', async () => {
    const { result } = renderHook(() => useSelectionPreserver())

    await act(async () => {
      await result.current(async () => {
        // No change to selectionState
      })
    })

    expect(setSelectionMock).not.toHaveBeenCalled()
  })
})
