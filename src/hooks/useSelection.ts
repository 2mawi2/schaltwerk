import { useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  selectionValueAtom,
  terminalsAtom,
  isReadyAtom,
  isSpecAtom,
  setSelectionActionAtom,
  clearTerminalTrackingActionAtom,
  type Selection,
} from '../store/atoms/selection'

export function useSelection() {
  const selection = useAtomValue(selectionValueAtom)
  const terminals = useAtomValue(terminalsAtom)
  const isReady = useAtomValue(isReadyAtom)
  const isSpec = useAtomValue(isSpecAtom)
  const setSelectionAtomSetter = useSetAtom(setSelectionActionAtom)
  const clearTerminalTracking = useSetAtom(clearTerminalTrackingActionAtom)

  const setSelection = useCallback(
    (nextSelection: Selection, forceRecreate?: boolean, isIntentional?: boolean) =>
      setSelectionAtomSetter({ selection: nextSelection, forceRecreate, isIntentional }),
    [setSelectionAtomSetter],
  )

  return {
    selection,
    terminals,
    isReady,
    isSpec,
    setSelection,
    clearTerminalTracking,
  }
}

export type { Selection }
