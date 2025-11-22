import { atomWithStorage, createJSONStorage } from 'jotai/utils'

type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const createMemoryStorage = (): StorageLike => {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  }
}

const createPersistentStorage = (): StorageLike => {
  if (typeof window === 'undefined') {
    return createMemoryStorage()
  }

  const local = window.localStorage
  const session = window.sessionStorage

  return {
    getItem: (key: string) => {
      // Prefer migrating legacy sessionStorage first to avoid stale defaults
      const sessionValue = session?.getItem(key)
      if (sessionValue !== null) {
        try {
          local.setItem(key, sessionValue)
          session.removeItem(key)
        } catch {
          // If write fails (disk full or private mode), still return the session value
        }
        return sessionValue
      }

      const localValue = local.getItem(key)
      if (localValue !== null) {
        return localValue
      }

      return null
    },
    setItem: (key: string, value: string) => {
      try {
        local.setItem(key, value)
      } catch {
        // Best-effort fallback to sessionStorage if localStorage is unavailable
        try {
          session.setItem(key, value)
        } catch {
          // ignore
        }
      }
    },
    removeItem: (key: string) => {
      try {
        local.removeItem(key)
      } catch {
        // ignore
      }
      try {
        session?.removeItem(key)
      } catch {
        // ignore
      }
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const storage = createJSONStorage(() => createPersistentStorage()) as any

// One-time migration to move legacy sessionStorage values into localStorage eagerly
if (typeof window !== 'undefined') {
  try {
    const legacyKeys = [
      'schaltwerk:layout:leftPanelCollapsed',
      'schaltwerk:layout:leftPanelSizes',
      'schaltwerk:layout:leftPanelLastExpandedSizes',
      'schaltwerk:layout:rightPanelCollapsed',
      'schaltwerk:layout:rightPanelSizes',
      'schaltwerk:layout:rightPanelLastExpandedSize',
      'schaltwerk:layout:bottomTerminalCollapsed',
      'schaltwerk:layout:bottomTerminalSizes',
      'schaltwerk:layout:bottomTerminalLastExpandedSize',
    ]
    for (const key of legacyKeys) {
      const legacy = window.sessionStorage?.getItem(key)
      if (legacy !== null) {
        window.localStorage.setItem(key, legacy)
        window.sessionStorage.removeItem(key)
      }
    }
  } catch {
    // ignore migration errors; runtime storage access may be restricted
  }
}

// Left Panel Atoms
export const leftPanelCollapsedAtom = atomWithStorage<boolean>(
  'schaltwerk:layout:leftPanelCollapsed',
  false,
  storage,
  { getOnInit: true }
)

export const leftPanelSizesAtom = atomWithStorage<number[]>(
  'schaltwerk:layout:leftPanelSizes',
  [20, 80],
  storage,
  { getOnInit: true }
)

export const leftPanelLastExpandedSizesAtom = atomWithStorage<number[]>(
  'schaltwerk:layout:leftPanelLastExpandedSizes',
  [20, 80],
  storage,
  { getOnInit: true }
)

// Right Panel Atoms
export const rightPanelCollapsedAtom = atomWithStorage<boolean>(
  'schaltwerk:layout:rightPanelCollapsed',
  false,
  storage,
  { getOnInit: true }
)

export const rightPanelSizesAtom = atomWithStorage<number[]>(
  'schaltwerk:layout:rightPanelSizes',
  [70, 30],
  storage,
  { getOnInit: true }
)

export const rightPanelLastExpandedSizeAtom = atomWithStorage<number>(
  'schaltwerk:layout:rightPanelLastExpandedSize',
  30,
  storage,
  { getOnInit: true }
)

// Bottom Terminal Atoms
export const bottomTerminalCollapsedAtom = atomWithStorage<boolean>(
  'schaltwerk:layout:bottomTerminalCollapsed',
  false,
  storage,
  { getOnInit: true }
)

export const bottomTerminalSizesAtom = atomWithStorage<number[]>(
  'schaltwerk:layout:bottomTerminalSizes',
  [72, 28],
  storage,
  { getOnInit: true }
)

export const bottomTerminalLastExpandedSizeAtom = atomWithStorage<number>(
  'schaltwerk:layout:bottomTerminalLastExpandedSize',
  28,
  storage,
  { getOnInit: true }
)
