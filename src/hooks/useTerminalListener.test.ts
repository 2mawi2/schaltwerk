import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTerminalListener } from './useTerminalListener'
import * as eventSystem from '../common/eventSystem'
import * as backend from '../terminal/transport/backend'

const mockListenTerminalOutput = vi.spyOn(eventSystem, 'listenTerminalOutput')
const mockSubscribeTerminalBackend = vi.spyOn(backend, 'subscribeTerminalBackend')
const mockIsPluginTerminal = vi.spyOn(backend, 'isPluginTerminal')

describe('useTerminalListener', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsPluginTerminal.mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should not setup listener when terminalId is null', () => {
    renderHook(() => useTerminalListener({
      terminalId: null,
      onOutput: vi.fn()
    }))

    expect(mockListenTerminalOutput).not.toHaveBeenCalled()
    expect(mockSubscribeTerminalBackend).not.toHaveBeenCalled()
  })

  it('should not setup listener when enabled is false', () => {
    renderHook(() => useTerminalListener({
      terminalId: 'test-terminal',
      onOutput: vi.fn(),
      enabled: false
    }))

    expect(mockListenTerminalOutput).not.toHaveBeenCalled()
    expect(mockSubscribeTerminalBackend).not.toHaveBeenCalled()
  })

  it('should setup standard listener when plugin is not active', async () => {
    const unlistenFn = vi.fn()
    mockListenTerminalOutput.mockResolvedValue(unlistenFn)
    const onOutput = vi.fn()

    const { unmount } = renderHook(() => useTerminalListener({
      terminalId: 'test-terminal',
      onOutput
    }))

    await vi.waitFor(() => {
      expect(mockListenTerminalOutput).toHaveBeenCalledWith('test-terminal', expect.any(Function))
    })

    unmount()
    expect(unlistenFn).toHaveBeenCalled()
  })

  it('should setup plugin listener when plugin is active', async () => {
    mockIsPluginTerminal.mockReturnValue(true)
    const unsubscribeFn = vi.fn()
    mockSubscribeTerminalBackend.mockResolvedValue(unsubscribeFn)
    const onOutput = vi.fn()

    const { unmount } = renderHook(() => useTerminalListener({
      terminalId: 'test-terminal',
      onOutput,
      usePlugin: true
    }))

    await vi.waitFor(() => {
      expect(mockSubscribeTerminalBackend).toHaveBeenCalledWith(
        'test-terminal',
        0,
        expect.any(Function)
      )
    })

    unmount()
    expect(unsubscribeFn).toHaveBeenCalled()
  })

  it('should call onOutput with received data', async () => {
    let capturedCallback: ((output: string) => void | Promise<void>) | undefined
    mockListenTerminalOutput.mockImplementation(async (_id, callback) => {
      capturedCallback = callback
      return vi.fn()
    })

    const onOutput = vi.fn()
    renderHook(() => useTerminalListener({
      terminalId: 'test-terminal',
      onOutput
    }))

    await vi.waitFor(() => {
      expect(mockListenTerminalOutput).toHaveBeenCalled()
    })

    capturedCallback?.('test output')
    expect(onOutput).toHaveBeenCalledWith('test output')
  })

  it('should handle listener setup failure gracefully', async () => {
    const error = new Error('Setup failed')
    mockListenTerminalOutput.mockRejectedValue(error)
    const onOutput = vi.fn()

    renderHook(() => useTerminalListener({
      terminalId: 'test-terminal',
      onOutput
    }))

    await vi.waitFor(() => {
      expect(mockListenTerminalOutput).toHaveBeenCalled()
    })

    expect(onOutput).not.toHaveBeenCalled()
  })

  it('should use latest handler without recreating listener', async () => {
    const unlistenFn = vi.fn()
    mockListenTerminalOutput.mockResolvedValue(unlistenFn)

    const onOutput1 = vi.fn()
    const onOutput2 = vi.fn()

    const { rerender } = renderHook(
      ({ onOutput }) => useTerminalListener({ terminalId: 'test-terminal', onOutput }),
      { initialProps: { onOutput: onOutput1 } }
    )

    await vi.waitFor(() => {
      expect(mockListenTerminalOutput).toHaveBeenCalledTimes(1)
    })

    rerender({ onOutput: onOutput2 })
    expect(mockListenTerminalOutput).toHaveBeenCalledTimes(1)
  })

  it('should recreate listener when terminalId changes', async () => {
    const unlisten1 = vi.fn()
    const unlisten2 = vi.fn()
    mockListenTerminalOutput
      .mockResolvedValueOnce(unlisten1)
      .mockResolvedValueOnce(unlisten2)

    const { rerender } = renderHook(
      ({ terminalId }) => useTerminalListener({ terminalId, onOutput: vi.fn() }),
      { initialProps: { terminalId: 'terminal-1' } }
    )

    await vi.waitFor(() => {
      expect(mockListenTerminalOutput).toHaveBeenCalledWith('terminal-1', expect.any(Function))
    })

    rerender({ terminalId: 'terminal-2' })

    await vi.waitFor(() => {
      expect(unlisten1).toHaveBeenCalled()
      expect(mockListenTerminalOutput).toHaveBeenCalledWith('terminal-2', expect.any(Function))
    })
  })

  it('should recreate listener when agentType changes', async () => {
    const unlisten1 = vi.fn()
    const unlisten2 = vi.fn()
    mockListenTerminalOutput
      .mockResolvedValueOnce(unlisten1)
      .mockResolvedValueOnce(unlisten2)

    const { rerender } = renderHook(
      ({ agentType }) => useTerminalListener({ terminalId: 'test-terminal', onOutput: vi.fn(), agentType }),
      { initialProps: { agentType: 'claude' } }
    )

    await vi.waitFor(() => {
      expect(mockListenTerminalOutput).toHaveBeenCalledTimes(1)
    })

    rerender({ agentType: 'opencode' })

    await vi.waitFor(() => {
      expect(unlisten1).toHaveBeenCalled()
      expect(mockListenTerminalOutput).toHaveBeenCalledTimes(2)
    })
  })

  it('should cleanup listener on unmount', async () => {
    const unlistenFn = vi.fn()
    mockListenTerminalOutput.mockResolvedValue(unlistenFn)

    const { unmount } = renderHook(() => useTerminalListener({
      terminalId: 'test-terminal',
      onOutput: vi.fn()
    }))

    await vi.waitFor(() => {
      expect(mockListenTerminalOutput).toHaveBeenCalled()
    })

    unmount()
    expect(unlistenFn).toHaveBeenCalled()
  })

  it('should handle cleanup after unmount during setup', async () => {
    const unlistenFn = vi.fn()
    let resolveListener: (() => void) | undefined

    mockListenTerminalOutput.mockImplementation(async () => {
      await new Promise<void>(resolve => {
        resolveListener = resolve
      })
      return unlistenFn
    })

    const { unmount } = renderHook(() => useTerminalListener({
      terminalId: 'test-terminal',
      onOutput: vi.fn()
    }))

    unmount()
    resolveListener?.()

    await vi.waitFor(() => {
      expect(unlistenFn).toHaveBeenCalled()
    })
  })
})
