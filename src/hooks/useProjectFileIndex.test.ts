import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useProjectFileIndex } from './useProjectFileIndex'
import { TauriCommands } from '../common/tauriCommands'

const unlistenMock = vi.fn()
const eventHandlers: Array<(payload: string[]) => void> = []

vi.mock('../common/eventSystem', () => ({
  SchaltEvent: {
    ProjectFilesUpdated: 'schaltwerk:project-files-updated'
  },
  listenEvent: vi.fn(async (_event: string, handler: (payload: string[]) => void) => {
    eventHandlers.push(handler)
    return unlistenMock
  })
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

const { invoke } = await import('@tauri-apps/api/core')

describe('useProjectFileIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventHandlers.length = 0
  })

  it('fetches file list once and caches the result', async () => {
    vi.mocked(invoke).mockResolvedValue(['README.md', 'src/index.ts'])

    const { result } = renderHook(() => useProjectFileIndex())

    let files: string[] = []
    await act(async () => {
      files = await result.current.ensureIndex()
    })

    expect(files).toEqual(['README.md', 'src/index.ts'])
    expect(result.current.files).toEqual(['README.md', 'src/index.ts'])
    expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreListProjectFiles, { force_refresh: false })

    vi.mocked(invoke).mockClear()

    let secondCall: string[] = []
    await act(async () => {
      secondCall = await result.current.ensureIndex()
    })

    expect(secondCall).toEqual(['README.md', 'src/index.ts'])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('forces refresh when requested', async () => {
    vi.mocked(invoke).mockResolvedValue(['one.ts'])

    const { result } = renderHook(() => useProjectFileIndex())

    await act(async () => {
      await result.current.ensureIndex()
    })

    vi.mocked(invoke).mockClear()
    vi.mocked(invoke).mockResolvedValue(['one.ts', 'two.ts'])

    let refreshed: string[] = []
    await act(async () => {
      refreshed = await result.current.refreshIndex()
    })

    expect(refreshed).toEqual(['one.ts', 'two.ts'])
    expect(result.current.files).toEqual(['one.ts', 'two.ts'])
    expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreListProjectFiles, { force_refresh: true })
  })

  it('updates cached files when ProjectFilesUpdated event fires', async () => {
    vi.mocked(invoke).mockResolvedValue(['alpha.ts'])

    const { result } = renderHook(() => useProjectFileIndex())

    await act(async () => {
      await result.current.ensureIndex()
    })

    expect(eventHandlers.length).toBeGreaterThan(0)

    act(() => {
      eventHandlers.forEach(handler => handler(['beta.ts', 'gamma.ts']))
    })

    expect(result.current.files).toEqual(['beta.ts', 'gamma.ts'])
  })
})
