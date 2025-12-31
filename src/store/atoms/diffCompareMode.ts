import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'

export type DiffCompareMode = 'merge_base' | 'unpushed_only'

export const diffCompareModeAtomFamily = atomFamily((_sessionName: string) =>
  atom<DiffCompareMode>('merge_base')
)

export const hasRemoteTrackingBranchAtomFamily = atomFamily((_sessionName: string) =>
  atom<boolean | null>(null)
)
