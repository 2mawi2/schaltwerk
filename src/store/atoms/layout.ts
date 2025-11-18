import { atomWithStorage, createJSONStorage } from 'jotai/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const storage = createJSONStorage(() => sessionStorage) as any

// Right Panel Atoms
export const rightPanelCollapsedAtom = atomWithStorage<boolean>(
  'schaltwerk:layout:rightPanelCollapsed', 
  false, 
  storage
)

export const rightPanelSizesAtom = atomWithStorage<number[]>(
  'schaltwerk:layout:rightPanelSizes', 
  [70, 30], 
  storage
)

export const rightPanelLastExpandedSizeAtom = atomWithStorage<number>(
  'schaltwerk:layout:rightPanelLastExpandedSize',
  30,
  storage
)

// Bottom Terminal Atoms
export const bottomTerminalCollapsedAtom = atomWithStorage<boolean>(
  'schaltwerk:layout:bottomTerminalCollapsed', 
  false, 
  storage
)

export const bottomTerminalSizesAtom = atomWithStorage<number[]>(
  'schaltwerk:layout:bottomTerminalSizes', 
  [72, 28], 
  storage
)

export const bottomTerminalLastExpandedSizeAtom = atomWithStorage<number>(
  'schaltwerk:layout:bottomTerminalLastExpandedSize',
  28,
  storage
)
