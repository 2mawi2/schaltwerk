import { atomWithStorage } from 'jotai/utils'
import { layoutStorage } from './layout'
import type { TabKey } from '../../components/right-panel/RightPanelTabs.types'

export const rightPanelTabAtom = atomWithStorage<TabKey>(
  'schaltwerk:layout:rightPanelTab',
  'changes',
  layoutStorage,
  { getOnInit: true }
)
