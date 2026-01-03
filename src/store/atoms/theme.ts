import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { applyThemeToDOM } from '../../common/themes/cssInjector'
import type { ThemeId, ResolvedTheme } from '../../common/themes/types'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'
import { logger } from '../../utils/logger'

const themeIdAtom = atom<ThemeId>('dark')
const initializedAtom = atom(false)
const systemPrefersDarkAtom = atom(true)

const resolveThemeId = (themeId: ThemeId, prefersDark: boolean): ResolvedTheme => {
  if (themeId === 'system') {
    return prefersDark ? 'dark' : 'light'
  }
  return themeId
}

const isThemeId = (value: unknown): value is ThemeId =>
  value === 'dark' || value === 'light' || value === 'tokyonight' || value === 'catppuccin' || value === 'catppuccin-macchiato' || value === 'everforest' || value === 'ayu' || value === 'kanagawa' || value === 'system'

export const resolvedThemeAtom = atom<ResolvedTheme>((get) =>
  resolveThemeId(get(themeIdAtom), get(systemPrefersDarkAtom))
)

export const currentThemeIdAtom = atom((get) => get(themeIdAtom))

export const setThemeActionAtom = atom(
  null,
  async (get, set, newThemeId: ThemeId) => {
    set(themeIdAtom, newThemeId)
    const resolved = resolveThemeId(newThemeId, get(systemPrefersDarkAtom))

    applyThemeToDOM(resolved)
    emitUiEvent(UiEvent.ThemeChanged, { themeId: newThemeId, resolved })

    if (get(initializedAtom)) {
      try {
        await invoke(TauriCommands.SchaltwerkCoreSetTheme, { theme: newThemeId })
      } catch (error) {
        logger.error('Failed to save theme preference:', error)
      }
    }
  }
)

export const initializeThemeActionAtom = atom(
  null,
  async (get, set) => {
    let savedTheme: ThemeId = 'dark'

    try {
      const saved = await invoke<string>(TauriCommands.SchaltwerkCoreGetTheme)
      savedTheme = isThemeId(saved) ? saved : 'dark'
    } catch (error) {
      logger.error('Failed to load theme preference:', error)
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    set(systemPrefersDarkAtom, mediaQuery.matches)

    const handleChange = (event: MediaQueryListEvent) => {
      set(systemPrefersDarkAtom, event.matches)
      if (get(themeIdAtom) === 'system') {
        const resolved = event.matches ? 'dark' : 'light'
        applyThemeToDOM(resolved)
        emitUiEvent(UiEvent.ThemeChanged, { themeId: 'system', resolved })
      }
    }

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleChange)
    }

    set(themeIdAtom, savedTheme)
    const resolved = resolveThemeId(savedTheme, mediaQuery.matches)
    applyThemeToDOM(resolved)
    emitUiEvent(UiEvent.ThemeChanged, { themeId: savedTheme, resolved })
    set(initializedAtom, true)
  }
)
