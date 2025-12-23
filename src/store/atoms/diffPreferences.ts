import { atom } from 'jotai'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../../utils/logger'

export type DiffLayoutMode = 'unified' | 'split'

interface DiffViewPreferences {
  continuous_scroll?: boolean
  compact_diffs?: boolean
  sidebar_width?: number
  inline_sidebar_default?: boolean
  diff_layout?: DiffLayoutMode
}

const inlineSidebarDefaultAtom = atom<boolean>(true)
const diffLayoutAtom = atom<DiffLayoutMode>('unified')
const initializedAtom = atom(false)

let lastSavedValue: { inline_sidebar_default: boolean; diff_layout: DiffLayoutMode } | null = null
let pendingSaveValue: Partial<{ inline_sidebar_default: boolean; diff_layout: DiffLayoutMode }> = {}
let saveScheduled = false

function scheduleSave(next: Partial<{ inline_sidebar_default: boolean; diff_layout: DiffLayoutMode }>) {
  pendingSaveValue = { ...pendingSaveValue, ...next }

  if (saveScheduled) return
  saveScheduled = true

  const flushSave = () => {
    saveScheduled = false
    const baseline = lastSavedValue ?? { inline_sidebar_default: true, diff_layout: 'unified' as const }
    const pending = pendingSaveValue
    pendingSaveValue = {}

    const merged = {
      inline_sidebar_default: pending.inline_sidebar_default ?? baseline.inline_sidebar_default,
      diff_layout: pending.diff_layout ?? baseline.diff_layout,
    }

    if (
      lastSavedValue &&
      lastSavedValue.inline_sidebar_default === merged.inline_sidebar_default &&
      lastSavedValue.diff_layout === merged.diff_layout
    ) {
      return
    }

    lastSavedValue = merged

    invoke<DiffViewPreferences>(TauriCommands.GetDiffViewPreferences)
      .then((current) => {
        const payload = {
          continuous_scroll: current?.continuous_scroll ?? false,
          compact_diffs: current?.compact_diffs ?? true,
          sidebar_width: current?.sidebar_width ?? 320,
          inline_sidebar_default: merged.inline_sidebar_default,
          diff_layout: merged.diff_layout,
        }
        return invoke(TauriCommands.SetDiffViewPreferences, { preferences: payload })
      })
      .catch(err => logger.error('Failed to save diff preferences:', err))
  }

  if (typeof queueMicrotask === 'function') {
    queueMicrotask(flushSave)
    return
  }

  Promise.resolve().then(flushSave).catch(err => {
    logger.error('Failed to schedule diff preferences save:', err)
  })
}

export const inlineSidebarDefaultPreferenceAtom = atom(
  (get) => get(inlineSidebarDefaultAtom),
  (get, set, newValue: boolean) => {
    set(inlineSidebarDefaultAtom, newValue)

    if (get(initializedAtom)) {
      scheduleSave({
        inline_sidebar_default: newValue,
        diff_layout: get(diffLayoutAtom),
      })
    }
  }
)

export const diffLayoutPreferenceAtom = atom(
  (get) => get(diffLayoutAtom),
  (get, set, newValue: DiffLayoutMode) => {
    set(diffLayoutAtom, newValue)

    if (get(initializedAtom)) {
      scheduleSave({
        inline_sidebar_default: get(inlineSidebarDefaultAtom),
        diff_layout: newValue,
      })
    }
  }
)

export const initializeInlineDiffPreferenceActionAtom = atom(
  null,
  async (_get, set) => {
    try {
      const prefs = await invoke<DiffViewPreferences>(TauriCommands.GetDiffViewPreferences)
      const value = prefs?.inline_sidebar_default ?? true
      const diffLayout = prefs?.diff_layout ?? 'unified'

      set(inlineSidebarDefaultAtom, value)
      set(diffLayoutAtom, diffLayout)
      lastSavedValue = {
        inline_sidebar_default: value,
        diff_layout: diffLayout,
      }
      set(initializedAtom, true)
    } catch (err) {
      logger.error('Failed to load inline diff preference:', err)
      set(diffLayoutAtom, 'unified')
      lastSavedValue = { inline_sidebar_default: true, diff_layout: 'unified' }
      set(initializedAtom, true)
    }
  }
)
