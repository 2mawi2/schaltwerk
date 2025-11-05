import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import type { HeaderActionConfig } from '../../types/actionButton'
import { logger } from '../../utils/logger'

const actionButtonsMapAtom = atom<Map<string, HeaderActionConfig>>(new Map())

export const actionButtonsListAtom = atom((get) => {
  return Array.from(get(actionButtonsMapAtom).values())
})

export const actionButtonsLoadingAtom = atom(false)
export const actionButtonsErrorAtom = atom<string | null>(null)

const lastLoadedProjectPathAtom = atom<string | null>(null)

export const registerActionButtonAtom = atom(
  null,
  (get, set, action: HeaderActionConfig) => {
    const current = get(actionButtonsMapAtom)
    const next = new Map(current)
    next.set(action.id, { ...action })
    set(actionButtonsMapAtom, next)
  }
)

export const unregisterActionButtonAtom = atom(
  null,
  (get, set, actionId: string) => {
    const current = get(actionButtonsMapAtom)
    if (!current.has(actionId)) {
      return
    }
    const next = new Map(current)
    next.delete(actionId)
    set(actionButtonsMapAtom, next)
  }
)

export const updateActionButtonColorAtom = atom(
  null,
  (get, set, payload: { id: string; color: string }) => {
    const { id, color } = payload
    const current = get(actionButtonsMapAtom)
    const existing = current.get(id)
    if (!existing) {
      return
    }
    const next = new Map(current)
    next.set(id, { ...existing, color })
    set(actionButtonsMapAtom, next)
  }
)

function mapButtons(buttons: HeaderActionConfig[]): Map<string, HeaderActionConfig> {
  return new Map(buttons.map(button => [button.id, { ...button }]))
}

interface LoadPayload {
  projectPath: string | null
}

export const loadActionButtonsAtom = atom(
  null,
  async (_get, set, payload: LoadPayload) => {
    const { projectPath } = payload
    if (!projectPath) {
      set(actionButtonsMapAtom, new Map())
      set(actionButtonsLoadingAtom, false)
      set(actionButtonsErrorAtom, null)
      set(lastLoadedProjectPathAtom, null)
      logger.debug('No project path available, skipping action buttons load')
      return
    }

    set(lastLoadedProjectPathAtom, projectPath)

    try {
      set(actionButtonsLoadingAtom, true)
      set(actionButtonsErrorAtom, null)
      logger.debug('Loading action buttons for project:', projectPath)
      const buttons = await invoke<HeaderActionConfig[]>(TauriCommands.GetProjectActionButtons)
      logger.debug('Action buttons loaded:', buttons)
      set(actionButtonsMapAtom, mapButtons(buttons))
    } catch (error) {
      logger.error('Failed to load action buttons:', error)
      const message = error instanceof Error ? error.message : 'Failed to load action buttons'
      set(actionButtonsErrorAtom, message)
      set(actionButtonsMapAtom, new Map())
    } finally {
      set(actionButtonsLoadingAtom, false)
    }
  }
)

interface SavePayload {
  buttons: HeaderActionConfig[]
  projectPath?: string | null
}

export const saveActionButtonsAtom = atom(
  null,
  async (get, set, payload: SavePayload) => {
    try {
      logger.debug('Saving action buttons payload:', payload.buttons)
      await invoke(TauriCommands.SetProjectActionButtons, { actions: payload.buttons })
      const projectPath = payload.projectPath ?? get(lastLoadedProjectPathAtom)
      logger.debug('Action buttons saved, reloading for project:', projectPath)
      await set(loadActionButtonsAtom, { projectPath: projectPath ?? null })
      return true
    } catch (error) {
      logger.error('Failed to save action buttons:', error)
      const message = error instanceof Error ? error.message : 'Failed to save action buttons'
      set(actionButtonsErrorAtom, message)
      return false
    }
  }
)

export const resetActionButtonsAtom = atom(
  null,
  async (get, set, payload?: { projectPath?: string | null }) => {
    try {
      logger.info('Resetting action buttons to backend defaults')
      await invoke<HeaderActionConfig[]>(TauriCommands.ResetProjectActionButtonsToDefaults)
      const projectPath = payload?.projectPath ?? get(lastLoadedProjectPathAtom)
      await set(loadActionButtonsAtom, { projectPath: projectPath ?? null })
      return true
    } catch (error) {
      logger.error('Failed to reset action buttons to defaults:', error)
      const message = error instanceof Error ? error.message : 'Failed to reset action buttons to defaults'
      set(actionButtonsErrorAtom, message)
      return false
    }
  }
)
