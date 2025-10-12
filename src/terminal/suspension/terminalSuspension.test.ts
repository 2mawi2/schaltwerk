import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalSuspensionManager } from './terminalSuspension'

interface BufferLineStub {
  translateToString: (trimRight?: boolean, start?: number, end?: number) => string
}

class FakeLine implements BufferLineStub {
  constructor(private text: string) {}
  translateToString(): string {
    return this.text
  }
}

class FakeTerminal {
  buffer = {
    active: {
      baseY: 0,
      viewportY: 0,
      length: 0,
      getLine: (index: number): BufferLineStub | undefined => this.lines[index]
    }
  }

  cols = 80
  rows = 24

  clearCalls = 0
  writes: string[] = []
  scrollTargets: number[] = []

  constructor(private lines: BufferLineStub[]) {
    this.buffer.active.length = lines.length
    vi.spyOn(this.buffer.active, 'getLine')
  }

  clear(): void {
    this.clearCalls++
  }

  write(data: string, callback?: () => void): void {
    this.writes.push(data)
    if (callback) callback()
  }

  scrollToLine(line: number): void {
    this.scrollTargets.push(line)
  }
}

function createManager(options?: Partial<Parameters<typeof TerminalSuspensionManager.getInstance>[0]>) {
  const existing = (TerminalSuspensionManager as unknown as { instance?: TerminalSuspensionManager }).instance
  existing?.dispose()
  ;(TerminalSuspensionManager as unknown as { instance?: TerminalSuspensionManager }).instance = undefined
  return TerminalSuspensionManager.getInstance({
    suspendAfterMs: 5,
    maxSuspendedTerminals: 2,
    snapshotSizeLimitBytes: 1024,
    keepAliveTerminalIds: new Set(),
    ...options
  })
}

interface SuspensionStateLike {
  suspended: boolean
  suspendedAt: number
  bufferSnapshot?: { data: string | undefined }
  scrollPosition?: { x: number; y: number }
}

type ManagerInternals = {
  terminals: Map<string, FakeTerminal>
  states: Map<string, SuspensionStateLike>
}

describe('TerminalSuspensionManager buffer snapshots', () => {
  let manager: TerminalSuspensionManager

  beforeEach(() => {
    manager = createManager()
  })

  afterEach(() => {
    manager.dispose()
  })

  it('captures and restores terminal buffer on suspend/resume', async () => {
    const terminal = new FakeTerminal([new FakeLine('line a'), new FakeLine('line b')])
    ;(manager as unknown as ManagerInternals).terminals.set('term-1', terminal)
    ;(manager as unknown as ManagerInternals).states.set('term-1', {
      suspended: false,
      suspendedAt: 0
    })

    const suspended = manager.suspend('term-1')
    expect(suspended).toBe(true)
    const state = (manager as unknown as ManagerInternals).states.get('term-1')
    expect(state?.bufferSnapshot?.data).toContain('line a')
    expect(terminal.clearCalls).toBe(1)

    const resumeResult = manager.resume('term-1')
    expect(resumeResult).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(terminal.writes.join('')).toContain('line a')
    expect(terminal.scrollTargets).toContain(0)
    const updatedState = (manager as unknown as ManagerInternals).states.get('term-1')
    expect(updatedState?.bufferSnapshot).toBeUndefined()
  })

  it('skips destructive clear when snapshot exceeds limit', () => {
    manager = createManager({ snapshotSizeLimitBytes: 4 })
    const terminal = new FakeTerminal([new FakeLine('oversized line')])
    ;(manager as unknown as ManagerInternals).terminals.set('term-2', terminal)
    ;(manager as unknown as ManagerInternals).states.set('term-2', {
      suspended: false,
      suspendedAt: 0
    })

    const suspended = manager.suspend('term-2')
    expect(suspended).toBe(true)
    const state = (manager as unknown as ManagerInternals).states.get('term-2')
    expect(state?.bufferSnapshot).toBeUndefined()
    expect(terminal.clearCalls).toBe(0)
  })

  it('evicts oldest snapshot when exceeding max suspended terminals', async () => {
    manager = createManager({ maxSuspendedTerminals: 1 })
    const terminalA = new FakeTerminal([new FakeLine('A')])
    const terminalB = new FakeTerminal([new FakeLine('B')])
    ;(manager as unknown as ManagerInternals).terminals.set('term-A', terminalA)
    ;(manager as unknown as ManagerInternals).terminals.set('term-B', terminalB)
    ;(manager as unknown as ManagerInternals).states.set('term-A', { suspended: false, suspendedAt: 0 })
    ;(manager as unknown as ManagerInternals).states.set('term-B', { suspended: false, suspendedAt: 0 })

    manager.suspend('term-A')
    expect((manager as unknown as ManagerInternals).states.get('term-A')?.bufferSnapshot).toBeDefined()

    manager.suspend('term-B')
    await Promise.resolve()
    await Promise.resolve()
    const stateA = (manager as unknown as ManagerInternals).states.get('term-A')
    const stateB = (manager as unknown as ManagerInternals).states.get('term-B')

    expect(stateA?.suspended).toBe(false)
    expect(stateA?.bufferSnapshot).toBeUndefined()
    expect(terminalA.writes.join('')).toContain('A')

    expect(stateB?.suspended).toBe(true)
    expect(stateB?.bufferSnapshot).toBeDefined()

    const debugInfo = manager.getSuspensionDebugInfo()
    expect(debugInfo.suspendedWithSnapshots).toBe(1)
    expect(debugInfo.totalSnapshotBytes).toBeGreaterThan(0)
  })
})
