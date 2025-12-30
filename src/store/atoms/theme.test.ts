import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore } from 'jotai'
import {
  currentThemeIdAtom,
  resolvedThemeAtom,
  setThemeActionAtom,
  initializeThemeActionAtom,
} from './theme'
import { TauriCommands } from '../../common/tauriCommands'
import { applyThemeToDOM } from '../../common/themes/cssInjector'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'

type MutableMediaQueryList = Omit<MediaQueryList, 'matches'> & { matches: boolean }
type MediaQueryListMock = MutableMediaQueryList & { __setMatches: (next: boolean) => void }

const createMatchMedia = (matches: boolean): MediaQueryListMock => {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const mediaQueryList = {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
      if (event === 'change') {
        listeners.add(listener)
      }
    }),
    removeEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
      if (event === 'change') {
        listeners.delete(listener)
      }
    }),
    addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    }),
    removeListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    }),
    dispatchEvent: vi.fn(),
    __setMatches: () => {},
  } as unknown as MediaQueryListMock

  mediaQueryList.__setMatches = (next: boolean) => {
    mediaQueryList.matches = next
    const event = { matches: next, media: mediaQueryList.media } as MediaQueryListEvent
    listeners.forEach((listener) => listener(event))
  }

  return mediaQueryList
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === TauriCommands.SchaltwerkCoreGetTheme) {
      return Promise.resolve('system')
    }
    if (cmd === TauriCommands.SchaltwerkCoreSetTheme) {
      return Promise.resolve()
    }
    return Promise.reject(new Error(`Unknown command: ${cmd}`))
  }),
}))

vi.mock('../../common/themes/cssInjector', () => ({
  applyThemeToDOM: vi.fn(),
}))

vi.mock('../../common/uiEvents', () => ({
  emitUiEvent: vi.fn(),
  UiEvent: {
    ThemeChanged: 'theme-changed',
  },
}))

describe('theme atoms', () => {
  let store: ReturnType<typeof createStore>
  let mediaQueryList: MediaQueryListMock

  beforeEach(() => {
    store = createStore()
    mediaQueryList = createMatchMedia(false)
    window.matchMedia = vi.fn().mockReturnValue(mediaQueryList)
    vi.clearAllMocks()
  })

  it('defaults to system theme and resolves to dark', () => {
    expect(store.get(currentThemeIdAtom)).toBe('system')
    expect(store.get(resolvedThemeAtom)).toBe('dark')
  })

  it('sets theme without persisting before initialization', async () => {
    await store.set(setThemeActionAtom, 'light')

    expect(store.get(currentThemeIdAtom)).toBe('light')
    expect(store.get(resolvedThemeAtom)).toBe('light')
    expect(vi.mocked(applyThemeToDOM)).toHaveBeenCalledWith('light')
    expect(vi.mocked(emitUiEvent)).toHaveBeenCalledWith(UiEvent.ThemeChanged, {
      themeId: 'light',
      resolved: 'light',
    })

    const { invoke } = await import('@tauri-apps/api/core')
    expect(invoke).not.toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetTheme, expect.anything())
  })

  it('initializes theme from backend and applies resolved theme', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValueOnce('dark')

    await store.set(initializeThemeActionAtom)

    expect(store.get(currentThemeIdAtom)).toBe('dark')
    expect(store.get(resolvedThemeAtom)).toBe('dark')
    expect(vi.mocked(applyThemeToDOM)).toHaveBeenCalledWith('dark')
  })

  it('falls back to system theme when backend returns invalid value', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValueOnce('neon')

    mediaQueryList.__setMatches(true)
    await store.set(initializeThemeActionAtom)

    expect(store.get(currentThemeIdAtom)).toBe('system')
    expect(store.get(resolvedThemeAtom)).toBe('dark')
    expect(vi.mocked(applyThemeToDOM)).toHaveBeenCalledWith('dark')
  })

  it('persists theme changes after initialization', async () => {
    const { invoke } = await import('@tauri-apps/api/core')

    vi.mocked(invoke).mockResolvedValueOnce('system')
    await store.set(initializeThemeActionAtom)
    vi.clearAllMocks()

    await store.set(setThemeActionAtom, 'light')

    expect(vi.mocked(invoke)).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreSetTheme, { theme: 'light' })
  })

  it('responds to system theme changes when using system preference', async () => {
    const { invoke } = await import('@tauri-apps/api/core')

    vi.mocked(invoke).mockResolvedValueOnce('system')
    await store.set(initializeThemeActionAtom)
    vi.clearAllMocks()

    mediaQueryList.__setMatches(true)

    expect(store.get(resolvedThemeAtom)).toBe('dark')
    expect(vi.mocked(applyThemeToDOM)).toHaveBeenCalledWith('dark')
    expect(vi.mocked(emitUiEvent)).toHaveBeenCalledWith(UiEvent.ThemeChanged, {
      themeId: 'system',
      resolved: 'dark',
    })
  })
})
