import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TauriCommands } from '../common/tauriCommands'
import { useSetupScriptApproval } from './useSetupScriptApproval'

const listenEventMock = vi.hoisted(() => vi.fn())
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('../common/eventSystem', () => ({
  listenEvent: listenEventMock,
  SchaltEvent: {
    SetupScriptRequested: 'schaltwerk:setup-script-request',
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

describe('useSetupScriptApproval', () => {
  beforeEach(() => {
    listenEventMock.mockReset()
    invokeMock.mockReset()
  })

  it('stores incoming setup script requests from events', async () => {
    let handler: ((payload: { setup_script: string }) => void) | null = null
    listenEventMock.mockImplementation(async (_event, h) => {
      handler = h
      return () => {}
    })

    const { result } = renderHook(() => useSetupScriptApproval())

    expect(listenEventMock).toHaveBeenCalled()
    await act(async () => {
      handler?.({ setup_script: '#!/bin/bash\necho hi' })
    })

    await waitFor(() => {
      expect(result.current.proposal?.setupScript).toContain('echo hi')
    })
  })

  it('applies the script through Tauri when approved', async () => {
    let handler: ((payload: { setup_script: string; has_setup_script?: boolean }) => void) | null = null
    listenEventMock.mockImplementation(async (_event, h) => {
      handler = h
      return () => {}
    })

    invokeMock.mockResolvedValueOnce({
      setupScript: '',
      branchPrefix: 'feature',
    })
    invokeMock.mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useSetupScriptApproval())

    await act(async () => {
      handler?.({ setup_script: '#!/bin/bash\necho hi', has_setup_script: true })
    })

    await act(async () => {
      await result.current.approve()
    })

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      TauriCommands.GetProjectSettings
    )
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      TauriCommands.SetProjectSettings,
      { settings: { setupScript: '#!/bin/bash\necho hi', branchPrefix: 'feature' } }
    )
    expect(result.current.proposal).toBeNull()
  })

  it('clears the proposal when rejected', async () => {
    let handler: ((payload: { setup_script: string }) => void) | null = null
    listenEventMock.mockImplementation(async (_event, h) => {
      handler = h
      return () => {}
    })

    const { result } = renderHook(() => useSetupScriptApproval())

    await act(async () => {
      handler?.({ setup_script: 'echo hi' })
    })

    await act(async () => {
      result.current.reject()
    })

    expect(result.current.proposal).toBeNull()
  })
})
