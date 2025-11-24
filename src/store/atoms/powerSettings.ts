import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { logger } from '../../utils/logger'

export type KeepAwakeState = 'disabled' | 'active' | 'auto_paused'

export interface PowerSettings {
  autoReleaseEnabled: boolean
  autoReleaseIdleMinutes: number
}

const defaultSettings: PowerSettings = {
  autoReleaseEnabled: true,
  autoReleaseIdleMinutes: 2,
}

export const keepAwakeStateAtom = atom<KeepAwakeState>('disabled')
export const powerSettingsAtom = atom<PowerSettings>(defaultSettings)

export const refreshPowerSettingsActionAtom = atom(null, async (_get, set) => {
  try {
    const settings = await invoke<PowerSettings>(TauriCommands.GetPowerSettings)
    set(powerSettingsAtom, settings)
  } catch (error) {
    logger.warn('Failed to load power settings', error)
  }
})

export const refreshKeepAwakeStateActionAtom = atom(null, async (_get, set) => {
  try {
    const state = await invoke<KeepAwakeState>(TauriCommands.GetGlobalKeepAwakeState)
    set(keepAwakeStateAtom, state)
  } catch (error) {
    logger.warn('Failed to load keep-awake state', error)
  }
})

export const toggleKeepAwakeActionAtom = atom(null, async (get, set) => {
  const current = get(keepAwakeStateAtom)
  const command = current === 'disabled'
    ? TauriCommands.EnableGlobalKeepAwake
    : TauriCommands.DisableGlobalKeepAwake

  try {
    const next = await invoke<KeepAwakeState | { state: KeepAwakeState }>(command)
    const resolved = typeof next === 'string' ? next : next.state
    set(keepAwakeStateAtom, resolved)
    return resolved
  } catch (error) {
    logger.error('Failed to toggle keep-awake', error)
    return undefined
  }
})

export const updatePowerSettingsActionAtom = atom(null, async (_get, set, next: PowerSettings) => {
  try {
    const updated = await invoke<PowerSettings>(TauriCommands.SetPowerSettings, { settings: next })
    set(powerSettingsAtom, updated)
  } catch (error) {
    logger.error('Failed to update power settings', error)
  }
})

/**
 * Subscribe to backend state events and update atoms in real time.
 */
export const registerKeepAwakeEventListenerActionAtom = atom(null, (_get, set) => {
  return listenEvent(SchaltEvent.GlobalKeepAwakeStateChanged, payload => {
    const next = (payload as { state?: KeepAwakeState }).state
    if (next) {
      set(keepAwakeStateAtom, next)
    }
  })
})
