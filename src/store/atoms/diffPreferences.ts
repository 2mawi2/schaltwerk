import { atom } from 'jotai'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../../utils/logger'

interface DiffViewPreferences {
  continuous_scroll?: boolean
  compact_diffs?: boolean
  sidebar_width?: number
  inline_sidebar_default?: boolean
}

const inlineSidebarDefaultAtom = atom<boolean>(true)
const initializedAtom = atom(false)

let lastSavedValue: boolean | null = null
let pendingSaveValue: boolean | null = null
let saveScheduled = false

function scheduleSave(value: boolean) {
  if (lastSavedValue === value) {
    return
  }

  pendingSaveValue = value

  if (saveScheduled) {
    return
  }

  saveScheduled = true
  const flushSave = () => {
    saveScheduled = false
    const nextValue = pendingSaveValue
    pendingSaveValue = null

    if (nextValue === null || lastSavedValue === nextValue) {
      return
    }

    lastSavedValue = nextValue

    invoke<DiffViewPreferences>(TauriCommands.GetDiffViewPreferences)
      .then((current) => {
        const payload: Required<DiffViewPreferences> = {
          continuous_scroll: current?.continuous_scroll ?? false,
          compact_diffs: current?.compact_diffs ?? true,
          sidebar_width: current?.sidebar_width ?? 320,
          inline_sidebar_default: nextValue,
        }
        return invoke(TauriCommands.SetDiffViewPreferences, { preferences: payload })
      })
      .catch(err => logger.error('Failed to save inline diff preference:', err))
  }

  if (typeof queueMicrotask === 'function') {
    queueMicrotask(flushSave)
  } else {
    Promise.resolve().then(flushSave).catch(err => {
      logger.error('Failed to schedule inline diff preference save:', err)
    })
  }
}

export const inlineSidebarDefaultPreferenceAtom = atom(
  (get) => get(inlineSidebarDefaultAtom),
  (get, set, newValue: boolean) => {
    set(inlineSidebarDefaultAtom, newValue)

    if (get(initializedAtom)) {
      scheduleSave(newValue)
    }
  }
)

export const initializeInlineDiffPreferenceActionAtom = atom(
  null,
  async (_get, set) => {
    try {
      const prefs = await invoke<DiffViewPreferences>(TauriCommands.GetDiffViewPreferences)
      const value = prefs?.inline_sidebar_default ?? true

      set(inlineSidebarDefaultAtom, value)
      lastSavedValue = value
      set(initializedAtom, true)
    } catch (err) {
      logger.error('Failed to load inline diff preference:', err)
      set(initializedAtom, true)
    }
  }
)
