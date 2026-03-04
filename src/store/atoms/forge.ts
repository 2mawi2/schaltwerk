import { atom } from 'jotai'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'

export type ForgeType = 'github' | 'gitlab' | 'unknown'

const forgeBaseAtom = atom<ForgeType>('unknown')

export const projectForgeAtom = atom(get => get(forgeBaseAtom))

export const refreshForgeAtom = atom(null, async (_get, set) => {
  try {
    const forge = await invoke<ForgeType>(TauriCommands.DetectProjectForge)
    set(forgeBaseAtom, forge)
  } catch (error) {
    logger.warn('[forge] Failed to detect project forge', { error })
    set(forgeBaseAtom, 'unknown')
  }
})
