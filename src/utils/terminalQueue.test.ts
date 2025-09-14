import { applyEnqueuePolicy, makeAgentQueueConfig, makeDefaultQueueConfig } from './terminalQueue'

describe('terminalQueue enqueue policy', () => {
  it('does not drop under threshold', () => {
    const cfg = makeDefaultQueueConfig()
    const start = { queue: [], queuedBytes: 0, droppedBytes: 0, overflowActive: false }
    const next = applyEnqueuePolicy(start, 'a'.repeat(cfg.lowWaterMark), cfg)
    expect(next.queue.join('').length).toBe(cfg.lowWaterMark)
    expect(next.droppedBytes).toBe(0)
    expect(next.overflowActive).toBe(false)
  })

  it('drops head and activates overflow once over max', () => {
    const cfg = makeDefaultQueueConfig()
    let state = { queue: ['x'.repeat(cfg.maxQueueBytes)], queuedBytes: cfg.maxQueueBytes, droppedBytes: 0, overflowActive: false }
    state = applyEnqueuePolicy(state, 'y'.repeat(1024), cfg)
    // We should be around targetAfterDrop + 1024; allow inclusive bound
    expect(state.queuedBytes).toBeGreaterThanOrEqual(cfg.targetAfterDrop)
    expect(state.queuedBytes).toBeLessThanOrEqual(cfg.targetAfterDrop + 1024)
    expect(state.droppedBytes).toBeGreaterThan(0)
    expect(state.overflowActive).toBe(true)
  })

  it('resets overflowActive after draining below lowWaterMark', () => {
    const cfg = makeDefaultQueueConfig()
    let state = { queue: ['x'.repeat(cfg.maxQueueBytes)], queuedBytes: cfg.maxQueueBytes, droppedBytes: 0, overflowActive: false }
    state = applyEnqueuePolicy(state, 'y'.repeat(1), cfg)
    expect(state.overflowActive).toBe(true)
    // Simulate draining by replacing queue/bytes directly below low water mark
    state.queue = ['z'.repeat(cfg.lowWaterMark - 10)]
    state.queuedBytes = cfg.lowWaterMark - 10
    // Add a small piece to trigger evaluation
    state = applyEnqueuePolicy(state, 'k', cfg)
    expect(state.overflowActive).toBe(false)
    expect(state.droppedBytes).toBe(0)
  })

  it('agent config uses larger limits', () => {
    const d = makeDefaultQueueConfig()
    const a = makeAgentQueueConfig()
    expect(a.maxQueueBytes).toBeGreaterThan(d.maxQueueBytes)
    expect(a.maxWriteChunk).toBeGreaterThan(d.maxWriteChunk)
  })
})
