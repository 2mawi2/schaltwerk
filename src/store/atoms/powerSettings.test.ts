import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from 'jotai'
import {
  keepAwakeStateAtom,
  registerKeepAwakeEventListenerActionAtom,
} from './powerSettings'
import { SchaltEvent } from '../../common/eventSystem'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const handlers: Array<(payload: unknown) => void> = []

vi.mock('../../common/eventSystem', () => ({
  listenEvent: vi.fn((event: string, handler: (payload: unknown) => void) => {
    if (event === SchaltEvent.GlobalKeepAwakeStateChanged) {
      handlers.push(handler)
    }
    return Promise.resolve(() => {})
  }),
  SchaltEvent: {
    GlobalKeepAwakeStateChanged: 'schaltwerk:global-keep-awake-state-changed',
  },
}))

describe('powerSettings atoms', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
    handlers.length = 0
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue('disabled')
  })

  it('updates keepAwakeState when backend event arrives', async () => {
    await store.set(registerKeepAwakeEventListenerActionAtom)

    expect(store.get(keepAwakeStateAtom)).toBe('disabled')
    expect(handlers.length).toBe(1)

    handlers[0]?.({ state: 'auto_paused' })

    expect(store.get(keepAwakeStateAtom)).toBe('auto_paused')
  })
})
