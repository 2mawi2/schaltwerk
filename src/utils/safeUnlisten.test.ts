import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { logger } from './logger'
import { safeUnlisten } from './safeUnlisten'

describe('safeUnlisten', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves when no unlisten function provided', async () => {
    await expect(safeUnlisten(undefined, 'missing-listener')).resolves.toBeUndefined()
    expect(logger.debug).not.toHaveBeenCalled()
  })

  it('logs and swallows synchronous errors', async () => {
    const error = new Error('boom')
    const unlisten = vi.fn(() => {
      throw error
    })

    await expect(safeUnlisten(unlisten, 'sync-test')).resolves.toBeUndefined()
    expect(unlisten).toHaveBeenCalledTimes(1)
    expect(logger.debug).toHaveBeenCalledWith('[safeUnlisten] Failed to clean up listener: sync-test', error)
  })

  it('logs and swallows rejected promises', async () => {
    const error = new Error('async-boom')
    const unlisten = vi.fn(async () => {
      throw error
    })

    await expect(safeUnlisten(unlisten, 'async-test')).resolves.toBeUndefined()
    expect(unlisten).toHaveBeenCalledTimes(1)
    expect(logger.debug).toHaveBeenCalledWith('[safeUnlisten] Failed to clean up listener: async-test', error)
  })

  it('runs listener cleanup successfully', async () => {
    const unlisten = vi.fn(() => Promise.resolve())
    await expect(safeUnlisten(unlisten, 'success-case')).resolves.toBeUndefined()
    expect(unlisten).toHaveBeenCalledTimes(1)
    expect(logger.debug).not.toHaveBeenCalled()
  })
})
