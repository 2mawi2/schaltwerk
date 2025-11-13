import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { MockedFunction } from 'vitest'
import { createStore } from 'jotai'
import {
  projectPathAtom,
  projectTabsAtom,
  openProjectActionAtom,
  selectProjectActionAtom,
  closeProjectActionAtom,
  __resetProjectsTestingState,
} from './project'
import { TauriCommands } from '../../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('project lifecycle atoms', () => {
  let store: ReturnType<typeof createStore>
  type InvokeFn = typeof import('@tauri-apps/api/core')['invoke']
  type InvokeArgsType = Parameters<InvokeFn>[1]
  let invoke: MockedFunction<InvokeFn>

  beforeEach(async () => {
    __resetProjectsTestingState()
    store = createStore()

    const core = await import('@tauri-apps/api/core')
    invoke = vi.mocked(core.invoke)
    invoke.mockReset()
    invoke.mockImplementation(async command => {
      switch (command) {
        case TauriCommands.InitializeProject:
        case TauriCommands.AddRecentProject:
        case TauriCommands.CloseProject:
          return null
        default:
          return null
      }
    })
  })

  it('defaults project path to null', () => {
    expect(store.get(projectPathAtom)).toBeNull()
  })

  it('opens a project, adds a tab, and focuses it', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/alpha' })

    expect(store.get(projectPathAtom)).toBe('/repo/alpha')
    expect(store.get(projectTabsAtom)).toMatchObject([
      {
        projectPath: '/repo/alpha',
        projectName: 'alpha',
        status: 'ready',
      },
    ])
    expect(invoke).toHaveBeenCalledWith(TauriCommands.InitializeProject, { path: '/repo/alpha' })
    expect(invoke).toHaveBeenCalledWith(TauriCommands.AddRecentProject, { path: '/repo/alpha' })
  })

  it('avoids reinitializing when opening the already active project', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/alpha' })
    invoke.mockClear()

    await store.set(openProjectActionAtom, { path: '/repo/alpha' })

    expect(invoke).not.toHaveBeenCalledWith(TauriCommands.InitializeProject, { path: '/repo/alpha' })
  })

  it('selects an existing project without duplicating tabs', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/alpha' })
    await store.set(openProjectActionAtom, { path: '/repo/beta' })
    invoke.mockClear()

    await store.set(selectProjectActionAtom, { path: '/repo/alpha' })

    expect(store.get(projectPathAtom)).toBe('/repo/alpha')
    expect(store.get(projectTabsAtom)).toHaveLength(2)
    expect(invoke).toHaveBeenCalledWith(TauriCommands.InitializeProject, { path: '/repo/alpha' })
  })

  it('closes the active project and activates the fallback tab', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/alpha' })
    await store.set(openProjectActionAtom, { path: '/repo/beta' })
    invoke.mockClear()

    const result = await store.set(closeProjectActionAtom, { path: '/repo/beta' })

    expect(result.nextActivePath).toBe('/repo/alpha')
    expect(store.get(projectPathAtom)).toBe('/repo/alpha')
    expect(store.get(projectTabsAtom)).toMatchObject([
      { projectPath: '/repo/alpha', status: 'ready' },
    ])
    expect(invoke).toHaveBeenCalledWith(TauriCommands.CloseProject, { path: '/repo/beta' })
  })

  it('closes the last project and clears the active path', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/solo' })
    invoke.mockClear()

    const result = await store.set(closeProjectActionAtom, { path: '/repo/solo' })

    expect(result.nextActivePath).toBeNull()
    expect(store.get(projectPathAtom)).toBeNull()
    expect(store.get(projectTabsAtom)).toHaveLength(0)
    expect(invoke).toHaveBeenCalledWith(TauriCommands.CloseProject, { path: '/repo/solo' })
  })

  it('marks a tab as errored when initialization fails', async () => {
    const ignoreBoom = (reason: unknown) => {
      if (reason instanceof Error && reason.message === 'boom') {
        return
      }
      throw reason
    }
    process.on('unhandledRejection', ignoreBoom)
    try {
      invoke.mockImplementation(async command => {
        if (command === TauriCommands.InitializeProject) {
          return Promise.resolve().then(() => {
            throw new Error('boom')
          })
        }
        return null
      })

      const result = await store.set(openProjectActionAtom, { path: '/repo/broken' })

      expect(result).toBe(false)
      expect(store.get(projectPathAtom)).toBeNull()
      expect(store.get(projectTabsAtom)).toMatchObject([
        {
          projectPath: '/repo/broken',
          status: 'error',
        },
      ])
    } finally {
      process.off('unhandledRejection', ignoreBoom)
    }
  })

  it('ignores duplicate project selections while a switch is in flight', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/shared' })
    invoke.mockClear()

    const first = store.set(selectProjectActionAtom, { path: '/repo/shared' })
    const second = store.set(selectProjectActionAtom, { path: '/repo/shared' })

    await first
    await second
    expect(store.get(projectPathAtom)).toBe('/repo/shared')
    expect(invoke).not.toHaveBeenCalledWith(TauriCommands.InitializeProject, { path: '/repo/shared' })
  })

  it('queues sequential project switches to avoid overlapping initialization', async () => {
    await store.set(openProjectActionAtom, { path: '/repo/base' })
    invoke.mockClear()

    const firstSwitch = deferredPromise()
    const secondSwitch = deferredPromise()

    invoke.mockImplementation(async (command, args?: InvokeArgsType) => {
      const pathArg = (args as { path?: string } | undefined)?.path
      if (command === TauriCommands.InitializeProject && pathArg === '/repo/one') {
        return firstSwitch.promise
      }
      if (command === TauriCommands.InitializeProject && pathArg === '/repo/two') {
        return secondSwitch.promise
      }
      return null
    })

    const first = store.set(selectProjectActionAtom, { path: '/repo/one' })
    const second = store.set(selectProjectActionAtom, { path: '/repo/two' })

    await flushMicrotask()
    expect(initializeCalls(invoke)[0]?.[1]).toEqual({ path: '/repo/one' })
    expect(initializeCalls(invoke).some(([, args]) => args?.path === '/repo/two')).toBe(false)

    firstSwitch.resolve()
    await first
    await flushMicrotask()

    expect(initializeCalls(invoke).some(([, args]) => args?.path === '/repo/two')).toBe(true)

    secondSwitch.resolve()
    await second
    expect(store.get(projectPathAtom)).toBe('/repo/two')
  })
})

function deferredPromise() {
  let resolve!: () => void
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return { promise, resolve }
}

async function flushMicrotask() {
  await Promise.resolve()
}

function initializeCalls(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.filter(([command]) => command === TauriCommands.InitializeProject)
}
