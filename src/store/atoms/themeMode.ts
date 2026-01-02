import { atom } from 'jotai'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../../utils/logger'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'
import { nativeWindowColors } from '../../common/theme'

export type ThemeMode = 'dark' | 'light'

const DEFAULT_THEME_MODE: ThemeMode = 'dark'

const themeModeAtom = atom<ThemeMode>(DEFAULT_THEME_MODE)
const initializedAtom = atom(false)

let lastSavedMode: ThemeMode | null = null

function applyNativeWindowBackground(mode: ThemeMode) {
  const color = nativeWindowColors[mode]
  invoke(TauriCommands.SetNativeWindowBackgroundColor, color)
    .catch(err => logger.error('Failed to set native window background:', err))
}

function applyThemeToDOM(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode
  applyNativeWindowBackground(mode)
}

export const themeModeValueAtom = atom((get) => get(themeModeAtom))

export const setThemeModeActionAtom = atom(
  null,
  (get, set, newMode: ThemeMode) => {
    set(themeModeAtom, newMode)
    applyThemeToDOM(newMode)
    emitUiEvent(UiEvent.ThemeModeChanged, { themeMode: newMode })

    if (get(initializedAtom) && lastSavedMode !== newMode) {
      lastSavedMode = newMode
      invoke(TauriCommands.SchaltwerkCoreSetThemeMode, { themeMode: newMode })
        .catch(err => logger.error('Failed to save theme mode:', err))
    }
  }
)

export const initializeThemeModeActionAtom = atom(
  null,
  async (_get, set) => {
    try {
      const mode = await invoke<ThemeMode>(TauriCommands.SchaltwerkCoreGetThemeMode)
      const validMode: ThemeMode = mode === 'light' ? 'light' : 'dark'

      set(themeModeAtom, validMode)
      lastSavedMode = validMode
      applyThemeToDOM(validMode)
      set(initializedAtom, true)
      emitUiEvent(UiEvent.ThemeModeChanged, { themeMode: validMode })
    } catch (err) {
      logger.error('Failed to load theme mode:', err)
      applyThemeToDOM(DEFAULT_THEME_MODE)
      set(initializedAtom, true)
    }
  }
)
