import { useCallback, useEffect, useRef, useState } from 'react'
import { logger } from '../utils/logger'
import { validatePanelPercentage } from '../utils/panel'

type PanelSizes = [number, number]

const DEFAULT_SIZES: PanelSizes = [70, 30]
const COLLAPSED_SIZES: PanelSizes = [100, 0]
const DEFAULT_LAST_EXPANDED = 30

const sizesStorageKey = (storageKey: string) => `schaltwerk:right-panel:sizes:${storageKey}`
const collapsedStorageKey = (storageKey: string) => `schaltwerk:right-panel:collapsed:${storageKey}`
const lastExpandedStorageKey = (storageKey: string) => `schaltwerk:right-panel:lastExpanded:${storageKey}`

interface StoredPanelState {
  sizes: PanelSizes
  isCollapsed: boolean
  lastExpandedRightPercent: number
}

interface UseRightPanelPersistenceArgs {
  storageKey: string
}

export interface UseRightPanelPersistenceReturn {
  sizes: PanelSizes
  setSizes: (value: PanelSizes | ((prev: PanelSizes) => PanelSizes)) => void
  isCollapsed: boolean
  toggleCollapsed: () => void
  setCollapsedExplicit: (collapsed: boolean) => void
}

const cloneSizes = (sizes: PanelSizes): PanelSizes => [sizes[0], sizes[1]] as PanelSizes

const parseStoredSizes = (raw: string | null, keyForLog: string): PanelSizes => {
  if (!raw) {
    return cloneSizes(DEFAULT_SIZES)
  }

  try {
    const parsed = JSON.parse(raw) as number[]
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [left, right] = parsed
      if (typeof left === 'number' && typeof right === 'number') {
        return [left, right] as PanelSizes
      }
    }
    logger.warn('[useRightPanelPersistence] Invalid stored panel sizes encountered:', parsed, 'Key:', keyForLog)
  } catch (error) {
    logger.warn('[useRightPanelPersistence] Failed to parse stored panel sizes:', error, 'Key:', keyForLog, 'Raw value:', raw)
  }

  return cloneSizes(DEFAULT_SIZES)
}

const loadStoredState = (storageKey: string): StoredPanelState => {
  const rawSizes = sessionStorage.getItem(sizesStorageKey(storageKey))
  const rawCollapsed = sessionStorage.getItem(collapsedStorageKey(storageKey))
  const rawLastExpanded = sessionStorage.getItem(lastExpandedStorageKey(storageKey))

  const lastExpanded = validatePanelPercentage(rawLastExpanded, DEFAULT_LAST_EXPANDED)
  const isCollapsed = rawCollapsed === 'true'
  const sizes = isCollapsed ? cloneSizes(COLLAPSED_SIZES) : parseStoredSizes(rawSizes, storageKey)

  return {
    sizes,
    isCollapsed,
    lastExpandedRightPercent: lastExpanded
  }
}

export function useRightPanelPersistence({ storageKey }: UseRightPanelPersistenceArgs): UseRightPanelPersistenceReturn {
  const initialStateRef = useRef<StoredPanelState>(loadStoredState(storageKey))
  const [sizes, setSizesState] = useState<PanelSizes>(initialStateRef.current.sizes)
  const [isCollapsed, setIsCollapsedState] = useState<boolean>(initialStateRef.current.isCollapsed)

  const storageKeyRef = useRef(storageKey)
  const sizesRef = useRef<PanelSizes>(initialStateRef.current.sizes)
  const isCollapsedRef = useRef<boolean>(initialStateRef.current.isCollapsed)
  const lastExpandedRef = useRef<number>(initialStateRef.current.lastExpandedRightPercent)
  const didInitRef = useRef(false)

  const persistLastExpanded = useCallback((value: number) => {
    if (value <= 0 || value >= 100) {
      return
    }

    lastExpandedRef.current = value
    sessionStorage.setItem(lastExpandedStorageKey(storageKeyRef.current), String(value))
  }, [])

  const applySizes = useCallback(
    (nextSizes: PanelSizes, options: { persistLastExpanded?: boolean } = {}) => {
      sizesRef.current = nextSizes
      setSizesState(nextSizes)
      sessionStorage.setItem(sizesStorageKey(storageKeyRef.current), JSON.stringify(nextSizes))

      const shouldPersistLastExpanded = options.persistLastExpanded ?? !isCollapsedRef.current
      if (shouldPersistLastExpanded) {
        const right = nextSizes[1]
        if (right > 0 && right < 100) {
          persistLastExpanded(right)
        }
      }
    },
    [persistLastExpanded]
  )

  const setCollapsedState = useCallback(
    (collapsed: boolean) => {
      isCollapsedRef.current = collapsed
      setIsCollapsedState(collapsed)
      sessionStorage.setItem(collapsedStorageKey(storageKeyRef.current), String(collapsed))

      if (collapsed) {
        const currentRight = sizesRef.current[1]
        if (currentRight > 0) {
          persistLastExpanded(currentRight)
        }
        applySizes(cloneSizes(COLLAPSED_SIZES), { persistLastExpanded: false })
      } else {
        const restoredRight = lastExpandedRef.current > 0 && lastExpandedRef.current < 100
          ? lastExpandedRef.current
          : DEFAULT_LAST_EXPANDED
        const restoredSizes: PanelSizes = [100 - restoredRight, restoredRight]
        applySizes(restoredSizes)
      }
    },
    [applySizes, persistLastExpanded]
  )

  const setSizes = useCallback<UseRightPanelPersistenceReturn['setSizes']>(
    (value) => {
      const nextSizes = typeof value === 'function' ? value(sizesRef.current) : value
      applySizes(nextSizes)
    },
    [applySizes]
  )

  const toggleCollapsed = useCallback(() => {
    setCollapsedState(!isCollapsedRef.current)
  }, [setCollapsedState])

  const setCollapsedExplicit = useCallback(
    (collapsed: boolean) => {
      setCollapsedState(collapsed)
    },
    [setCollapsedState]
  )

  useEffect(() => {
    if (storageKeyRef.current === storageKey && didInitRef.current) {
      return
    }

    storageKeyRef.current = storageKey
    const nextState = loadStoredState(storageKey)

    sizesRef.current = nextState.sizes
    isCollapsedRef.current = nextState.isCollapsed
    lastExpandedRef.current = nextState.lastExpandedRightPercent

    setSizesState(nextState.sizes)
    setIsCollapsedState(nextState.isCollapsed)

    didInitRef.current = true
  }, [storageKey])

  return {
    sizes,
    setSizes,
    isCollapsed,
    toggleCollapsed,
    setCollapsedExplicit
  }
}
