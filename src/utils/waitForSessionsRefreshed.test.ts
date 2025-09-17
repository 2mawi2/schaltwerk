import { describe, expect, it, vi } from 'vitest'
import { waitForSessionsRefreshed } from './waitForSessionsRefreshed'
import { listenEvent } from '../common/eventSystem'

type Listener = () => void

vi.mock('../common/eventSystem', () => {
  let listener: Listener | null = null
  return {
    SchaltEvent: {
      SessionsRefreshed: 'SessionsRefreshed',
    },
    listenEvent: vi.fn(async (_event: string, handler: Listener) => {
      listener = handler
      return () => {
        listener = null
      }
    }),
    __getListener: () => listener,
    __emitSessionsRefreshed: () => {
      listener?.()
    },
  }
})

const { __emitSessionsRefreshed, __getListener } = await import('../common/eventSystem') as unknown as {
  __emitSessionsRefreshed: () => void
  __getListener: () => Listener | null
}

describe('waitForSessionsRefreshed', () => {
  it('waits for listener registration before running action', async () => {
    await expect(
      waitForSessionsRefreshed(async () => {
        expect(__getListener()).toBeTruthy()
        __emitSessionsRefreshed()
      })
    ).resolves.toBeUndefined()

    expect(listenEvent).toHaveBeenCalledTimes(1)
    expect(__getListener()).toBeNull()
  })
})
