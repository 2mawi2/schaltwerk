import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import { TestProviders } from '../../tests/test-utils'
import { TauriCommands } from '../../common/tauriCommands'
import type { Event as TauriEvent } from '@tauri-apps/api/event'
import { logger } from '../../utils/logger'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

describe('Sidebar listener cleanup resilience', () => {
  const unhandledReasons: unknown[] = []
  const handleUnhandled = (reason: unknown) => { unhandledReasons.push(reason) }
  let loggerWarnSpy: MockInstance<(message: string, ...args: unknown[]) => void>

  beforeEach(() => {
    unhandledReasons.length = 0

    vi.clearAllMocks()

    loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    process.on('unhandledRejection', handleUnhandled)

    vi.mocked(invoke).mockImplementation(async (command: string) => {
      switch (command) {
        case TauriCommands.SchaltwerkCoreListEnrichedSessions:
        case TauriCommands.SchaltwerkCoreListSessionsByState:
          return []
        case TauriCommands.GetCurrentDirectory:
          return '/cwd'
        case TauriCommands.GetProjectSessionsSettings:
          return { filter_mode: 'all', sort_mode: 'lastModified' }
        case TauriCommands.TerminalExists:
          return false
        case TauriCommands.CreateTerminal:
          return undefined
        default:
          return undefined
      }
    })
  })

  afterEach(() => {
    process.off('unhandledRejection', handleUnhandled)
    vi.restoreAllMocks()
  })

  it('swallows promise rejections from already disposed listeners during cleanup', async () => {
    const rejectingUnlistenFns: Array<ReturnType<typeof vi.fn>> = []

    vi.mocked(listen).mockImplementation((_event: string, _cb: (evt: TauriEvent<unknown>) => void) => {
      const unlisten = vi.fn(() => Promise.reject(new Error('Listener already disposed')))
      rejectingUnlistenFns.push(unlisten)
      return Promise.resolve(unlisten)
    })

    const { unmount } = render(<TestProviders><Sidebar /></TestProviders>)

    await waitFor(() => {
      expect(listen).toHaveBeenCalled()
    })

    unmount()

    // Allow queued microtasks from rejected promises to surface
    await Promise.resolve()
    await Promise.resolve()

    expect(unhandledReasons).toHaveLength(0)

    expect(rejectingUnlistenFns.length).toBeGreaterThan(0)
    rejectingUnlistenFns.forEach(unlisten => {
      expect(unlisten).toHaveBeenCalledTimes(1)
    })

    expect(loggerWarnSpy).toHaveBeenCalled()
  })
})
