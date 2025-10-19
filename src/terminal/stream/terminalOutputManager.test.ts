import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../common/eventSystem', () => ({
  listenTerminalOutput: vi.fn()
}))

vi.mock('../transport/backend', () => ({
  subscribeTerminalBackend: vi.fn(),
  ackTerminalBackend: vi.fn(),
  isPluginTerminal: vi.fn()
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

import { terminalOutputManager } from './terminalOutputManager'
import { TauriCommands } from '../../common/tauriCommands'
import { listenTerminalOutput } from '../../common/eventSystem'
import { subscribeTerminalBackend, ackTerminalBackend, isPluginTerminal } from '../transport/backend'
import { invoke } from '@tauri-apps/api/core'

type VitestMock = ReturnType<typeof vi.fn>

const listenMock = listenTerminalOutput as unknown as VitestMock
const subscribeMock = subscribeTerminalBackend as unknown as VitestMock
const ackMock = ackTerminalBackend as unknown as VitestMock
const isPluginMock = isPluginTerminal as unknown as VitestMock
const invokeMock = invoke as unknown as VitestMock

describe('terminalOutputManager', () => {
  const TERMINAL_ID = 'terminal-stream-test'

  beforeEach(() => {
    vi.clearAllMocks()
    isPluginMock.mockReturnValue(false)
    ackMock.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await terminalOutputManager.dispose(TERMINAL_ID)
  })

  it('hydrates and listens for standard terminal output', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 42, startSeq: 0, data: 'snapshot-data' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.GetTerminalBuffer, {
      id: TERMINAL_ID,
      from_seq: null
    })
    expect(listener).toHaveBeenCalledWith('snapshot-data')
    expect(listenMock).toHaveBeenCalledWith(TERMINAL_ID, expect.any(Function))

    const callback = listenMock.mock.calls[0][1] as (chunk: string) => void
    callback('live-chunk')
    expect(listener).toHaveBeenCalledWith('live-chunk')

    await terminalOutputManager.dispose(TERMINAL_ID)
    expect(unlisten).toHaveBeenCalled()
  })

  it('streams plugin terminal output and acknowledges bytes', async () => {
    isPluginMock.mockReturnValue(true)
    const unsubscribe = vi.fn()
    subscribeMock.mockResolvedValueOnce(unsubscribe)
    invokeMock.mockResolvedValueOnce({ seq: 0, startSeq: 0, data: '' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    const callback = subscribeMock.mock.calls[0][2] as (message: { seq: number; bytes: Uint8Array }) => void
    const bytes = new TextEncoder().encode('plugin-data')
    callback({ seq: 7, bytes })

    expect(listener).toHaveBeenCalledWith('plugin-data')
    expect(ackMock).toHaveBeenCalledWith(TERMINAL_ID, 7, bytes.length)

    await terminalOutputManager.dispose(TERMINAL_ID)
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('restores stream after dispose and restart', async () => {
    const firstUnlisten = vi.fn()
    const secondUnlisten = vi.fn()
    listenMock
      .mockResolvedValueOnce(firstUnlisten)
      .mockResolvedValueOnce(secondUnlisten)
    invokeMock.mockResolvedValue({ seq: 0, startSeq: 0, data: '' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    await terminalOutputManager.dispose(TERMINAL_ID)
    expect(firstUnlisten).toHaveBeenCalled()

    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)
    await terminalOutputManager.dispose(TERMINAL_ID)
    expect(secondUnlisten).toHaveBeenCalled()
  })

  it('dispatches chunks to multiple listeners', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 1, startSeq: 0, data: '' })

    const listenerA = vi.fn()
    const listenerB = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listenerA)
    terminalOutputManager.addListener(TERMINAL_ID, listenerB)

    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    const callback = listenMock.mock.calls[0][1] as (chunk: string) => void
    callback('hello world')

    expect(listenerA).toHaveBeenCalledWith('hello world')
    expect(listenerB).toHaveBeenCalledWith('hello world')
  })

  it('ignores non-string chunks from standard stream', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 0, startSeq: 0, data: '' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    const callback = listenMock.mock.calls[0][1] as (chunk: unknown) => void
    callback(123 as unknown as string)
    callback(null as unknown as string)

    expect(listener).not.toHaveBeenCalled()
  })

  it('handles hydration failure gracefully', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockRejectedValueOnce(new Error('boom'))

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)
    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    expect(listenMock).toHaveBeenCalledWith(TERMINAL_ID, expect.any(Function))
  })

  it('does not start stream twice while a start is in progress', async () => {
    const unlisten = vi.fn()
    let resolver: () => void = () => {}
    const listenPromise = new Promise<() => void>(resolve => {
      resolver = () => resolve(unlisten)
    })
    listenMock.mockReturnValue(listenPromise)
    invokeMock.mockResolvedValueOnce({ seq: 0, startSeq: 0, data: '' })

    const listener = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listener)

    const first = terminalOutputManager.ensureStarted(TERMINAL_ID)
    const second = terminalOutputManager.ensureStarted(TERMINAL_ID)

    resolver()
    await Promise.all([first, second])

    expect(listenMock).toHaveBeenCalledTimes(1)
  })

  it('removes listener and stops dispatching chunks', async () => {
    const unlisten = vi.fn()
    listenMock.mockResolvedValueOnce(unlisten)
    invokeMock.mockResolvedValueOnce({ seq: 0, startSeq: 0, data: '' })

    const listenerA = vi.fn()
    const listenerB = vi.fn()
    terminalOutputManager.addListener(TERMINAL_ID, listenerA)
    terminalOutputManager.addListener(TERMINAL_ID, listenerB)

    await terminalOutputManager.ensureStarted(TERMINAL_ID)

    terminalOutputManager.removeListener(TERMINAL_ID, listenerA)

    const callback = listenMock.mock.calls[0][1] as (chunk: string) => void
    callback('chunk')

    expect(listenerA).not.toHaveBeenCalled()
    expect(listenerB).toHaveBeenCalledWith('chunk')
  })
})
