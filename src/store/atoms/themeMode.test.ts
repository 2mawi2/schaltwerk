import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from 'jotai'
import { themeModeValueAtom, setThemeModeActionAtom, initializeThemeModeActionAtom } from './themeMode'
import { TauriCommands } from '../../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === TauriCommands.SchaltwerkCoreGetThemeMode) {
      return Promise.resolve('dark')
    }
    if (cmd === TauriCommands.SchaltwerkCoreSetThemeMode) {
      return Promise.resolve()
    }
    return Promise.reject(new Error(`Unknown command: ${cmd}`))
  }),
}))

vi.mock('../../common/uiEvents', () => ({
  emitUiEvent: vi.fn(),
  UiEvent: {
    ThemeModeChanged: 'ui:theme-mode-changed',
  },
}))

describe('themeMode atoms', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
    vi.clearAllMocks()
    document.documentElement.dataset.theme = ''
  })

  it('defaults to dark mode', () => {
    expect(store.get(themeModeValueAtom)).toBe('dark')
  })

  it('setThemeModeActionAtom updates value and DOM', () => {
    store.set(setThemeModeActionAtom, 'light')
    expect(store.get(themeModeValueAtom)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('initializeThemeModeActionAtom loads theme from backend', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValueOnce('light')

    await store.set(initializeThemeModeActionAtom)
    expect(store.get(themeModeValueAtom)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('saves theme mode when changed after initialization', async () => {
    const { invoke } = await import('@tauri-apps/api/core')

    await store.set(initializeThemeModeActionAtom)
    vi.clearAllMocks()

    store.set(setThemeModeActionAtom, 'light')
    expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetThemeMode, {
      themeMode: 'light',
    })
  })
})
