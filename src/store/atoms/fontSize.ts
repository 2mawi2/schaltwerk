import { atom } from 'jotai'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../../utils/logger'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'

const DEFAULT_TERMINAL_FONT_SIZE = 13
const DEFAULT_UI_FONT_SIZE = 14
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 24
const FONT_SIZE_STEP = 1
const SAVE_DEBOUNCE_MS = 400

interface FontSizes {
  terminal: number
  ui: number
}

const fontSizesAtom = atom<FontSizes>({
  terminal: DEFAULT_TERMINAL_FONT_SIZE,
  ui: DEFAULT_UI_FONT_SIZE,
})

const initializedAtom = atom(false)

let saveTimeoutId: ReturnType<typeof setTimeout> | null = null
let lastSavedSizes: FontSizes | null = null

function debouncedSave(sizes: FontSizes) {
  if (lastSavedSizes &&
      lastSavedSizes.terminal === sizes.terminal &&
      lastSavedSizes.ui === sizes.ui) {
    return
  }

  if (saveTimeoutId !== null) {
    clearTimeout(saveTimeoutId)
  }

  saveTimeoutId = setTimeout(() => {
    if (lastSavedSizes &&
        lastSavedSizes.terminal === sizes.terminal &&
        lastSavedSizes.ui === sizes.ui) {
      return
    }
    lastSavedSizes = sizes
    invoke(TauriCommands.SchaltwerkCoreSetFontSizes, {
      terminalFontSize: sizes.terminal,
      uiFontSize: sizes.ui
    }).catch(err => logger.error('Failed to save font sizes:', err))
  }, SAVE_DEBOUNCE_MS)
}

export const terminalFontSizeAtom = atom(
  (get) => get(fontSizesAtom).terminal,
  (get, set, newSize: number) => {
    if (newSize >= MIN_FONT_SIZE && newSize <= MAX_FONT_SIZE) {
      const current = get(fontSizesAtom)
      const newSizes = { ...current, terminal: newSize }
      set(fontSizesAtom, newSizes)

      document.documentElement.style.setProperty('--terminal-font-size', `${newSize}px`)
      emitUiEvent(UiEvent.FontSizeChanged, { terminalFontSize: newSize, uiFontSize: current.ui })

      if (get(initializedAtom)) {
        debouncedSave(newSizes)
      }
    }
  }
)

export const uiFontSizeAtom = atom(
  (get) => get(fontSizesAtom).ui,
  (get, set, newSize: number) => {
    if (newSize >= MIN_FONT_SIZE && newSize <= MAX_FONT_SIZE) {
      const current = get(fontSizesAtom)
      const newSizes = { ...current, ui: newSize }
      set(fontSizesAtom, newSizes)

      document.documentElement.style.setProperty('--ui-font-size', `${newSize}px`)
      emitUiEvent(UiEvent.FontSizeChanged, { terminalFontSize: current.terminal, uiFontSize: newSize })

      if (get(initializedAtom)) {
        debouncedSave(newSizes)
      }
    }
  }
)

export const increaseFontSizesActionAtom = atom(
  null,
  (get, set) => {
    const current = get(fontSizesAtom)
    const newTerminal = Math.min(current.terminal + FONT_SIZE_STEP, MAX_FONT_SIZE)
    const newUi = Math.min(current.ui + FONT_SIZE_STEP, MAX_FONT_SIZE)
    const newSizes = { terminal: newTerminal, ui: newUi }

    set(fontSizesAtom, newSizes)

    document.documentElement.style.setProperty('--terminal-font-size', `${newTerminal}px`)
    document.documentElement.style.setProperty('--ui-font-size', `${newUi}px`)
    emitUiEvent(UiEvent.FontSizeChanged, { terminalFontSize: newTerminal, uiFontSize: newUi })

    if (get(initializedAtom)) {
      debouncedSave(newSizes)
    }
  }
)

export const decreaseFontSizesActionAtom = atom(
  null,
  (get, set) => {
    const current = get(fontSizesAtom)
    const newTerminal = Math.max(current.terminal - FONT_SIZE_STEP, MIN_FONT_SIZE)
    const newUi = Math.max(current.ui - FONT_SIZE_STEP, MIN_FONT_SIZE)
    const newSizes = { terminal: newTerminal, ui: newUi }

    set(fontSizesAtom, newSizes)

    document.documentElement.style.setProperty('--terminal-font-size', `${newTerminal}px`)
    document.documentElement.style.setProperty('--ui-font-size', `${newUi}px`)
    emitUiEvent(UiEvent.FontSizeChanged, { terminalFontSize: newTerminal, uiFontSize: newUi })

    if (get(initializedAtom)) {
      debouncedSave(newSizes)
    }
  }
)

export const resetFontSizesActionAtom = atom(
  null,
  (get, set) => {
    const newSizes = { terminal: DEFAULT_TERMINAL_FONT_SIZE, ui: DEFAULT_UI_FONT_SIZE }
    set(fontSizesAtom, newSizes)

    document.documentElement.style.setProperty('--terminal-font-size', `${DEFAULT_TERMINAL_FONT_SIZE}px`)
    document.documentElement.style.setProperty('--ui-font-size', `${DEFAULT_UI_FONT_SIZE}px`)
    emitUiEvent(UiEvent.FontSizeChanged, {
      terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
      uiFontSize: DEFAULT_UI_FONT_SIZE
    })

    if (get(initializedAtom)) {
      debouncedSave(newSizes)
    }
  }
)

export const initializeFontSizesActionAtom = atom(
  null,
  async (_get, set) => {
    try {
      const value = await invoke<unknown>(TauriCommands.SchaltwerkCoreGetFontSizes)

      let terminal: number | undefined
      let ui: number | undefined

      if (Array.isArray(value) && value.length >= 2) {
        const [t, u] = value as [number, number]
        terminal = t
        ui = u
      } else if (
        value !== null && typeof value === 'object' &&
        'terminal' in (value as Record<string, unknown>) &&
        'ui' in (value as Record<string, unknown>)
      ) {
        const obj = value as { terminal: number; ui: number }
        terminal = obj.terminal
        ui = obj.ui
      } else {
        throw new Error('Unexpected font size format')
      }

      const sizes: FontSizes = {
        terminal: (typeof terminal === 'number' && terminal >= MIN_FONT_SIZE && terminal <= MAX_FONT_SIZE)
          ? terminal
          : DEFAULT_TERMINAL_FONT_SIZE,
        ui: (typeof ui === 'number' && ui >= MIN_FONT_SIZE && ui <= MAX_FONT_SIZE)
          ? ui
          : DEFAULT_UI_FONT_SIZE,
      }

      set(fontSizesAtom, sizes)
      lastSavedSizes = sizes
      set(initializedAtom, true)

      document.documentElement.style.setProperty('--terminal-font-size', `${sizes.terminal}px`)
      document.documentElement.style.setProperty('--ui-font-size', `${sizes.ui}px`)
      emitUiEvent(UiEvent.FontSizeChanged, { terminalFontSize: sizes.terminal, uiFontSize: sizes.ui })
    } catch (err) {
      logger.error('Failed to load font sizes:', err)
      set(initializedAtom, true)
    }
  }
)
