import { describe, it, expect, vi, afterEach } from 'vitest'
import * as specRefine from './specRefine'
import { logger } from './logger'
import * as uiEvents from '../common/uiEvents'

describe('runSpecRefineWithOrchestrator', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('awaits orchestrator selection before emitting refine events', async () => {
    const selectOrchestrator = vi.fn().mockResolvedValue(undefined)
    const emitUiEventSpy = vi.spyOn(uiEvents, 'emitUiEvent').mockImplementation(() => {})

    await specRefine.runSpecRefineWithOrchestrator({
      sessionId: 'foo',
      displayName: 'Foo',
      selectOrchestrator,
      logContext: '[test]',
    })

    expect(selectOrchestrator).toHaveBeenCalledTimes(1)
    const insertCall = emitUiEventSpy.mock.calls.find(([event]) => event === uiEvents.UiEvent.InsertTerminalText)
    expect(insertCall).toBeDefined()
    expect(insertCall?.[1]).toEqual({ text: 'Refine spec: Foo (foo)' })
  })

  it('logs a warning but still emits when orchestrator selection fails', async () => {
    const error = new Error('boom')
    const selectOrchestrator = vi.fn().mockRejectedValue(error)
    const emitUiEventSpy = vi.spyOn(uiEvents, 'emitUiEvent').mockImplementation(() => {})
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})

    await specRefine.runSpecRefineWithOrchestrator({
      sessionId: 'foo',
      displayName: undefined,
      selectOrchestrator,
      logContext: '[test]',
    })

    expect(selectOrchestrator).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('[test] Failed to switch to orchestrator for refine', error)
    const insertCall = emitUiEventSpy.mock.calls.find(([event]) => event === uiEvents.UiEvent.InsertTerminalText)
    expect(insertCall?.[1]).toEqual({ text: 'Refine spec: foo (foo)' })
  })
})
