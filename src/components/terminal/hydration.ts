import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

export interface HydrateReusedTerminalOptions {
  isNew: boolean
  hydratedRef: MutableRefObject<boolean>
  hydratedOnceRef: MutableRefObject<boolean>
  setHydrated: Dispatch<SetStateAction<boolean>>
  onReady?: () => void
}

export function hydrateReusedTerminal({
  isNew,
  hydratedRef,
  hydratedOnceRef,
  setHydrated,
  onReady,
}: HydrateReusedTerminalOptions): boolean {
  if (isNew || hydratedRef.current) {
    return false
  }
  const firstHydration = !hydratedOnceRef.current
  hydratedRef.current = true
  hydratedOnceRef.current = true
  setHydrated(true)
  if (firstHydration && onReady) {
    onReady()
  }
  return true
}
