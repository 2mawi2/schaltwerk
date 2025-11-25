import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { logger } from '../../utils/logger'

export type KeepAwakeState = 'disabled' | 'active' | 'auto_paused'

export const keepAwakeStateAtom = atom<KeepAwakeState>('disabled')

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
    try {
      const fresh = await invoke<KeepAwakeState>(TauriCommands.GetGlobalKeepAwakeState)
      set(keepAwakeStateAtom, fresh)
      return fresh
    } catch (error) {
      logger.debug('Failed to refresh keep-awake state after toggle', error)
    }
    return resolved
  } catch (error) {
    logger.error('Failed to toggle keep-awake', error)
    return undefined
  }
})

export const registerKeepAwakeEventListenerActionAtom = atom(null, (_get, set) => {
  return listenEvent(SchaltEvent.GlobalKeepAwakeStateChanged, payload => {
    const next = (payload as { state?: KeepAwakeState }).state
    if (next) {
      set(keepAwakeStateAtom, next)
    }
  })
})
