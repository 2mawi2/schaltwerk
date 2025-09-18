import { useCallback, useRef } from 'react'
import { useSelection } from '../contexts/SelectionContext'
import type { Selection } from '../contexts/SelectionContext'
import { logger } from '../utils/logger'

function cloneSelection(selection: Selection | undefined): Selection | undefined {
  if (!selection) return selection
  return { ...selection }
}

function selectionsEqual(a: Selection | undefined, b: Selection | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'session' && b.kind === 'session') {
    return (a.payload ?? null) === (b.payload ?? null)
  }
  return true
}

export function useSelectionPreserver() {
  const { selection, setSelection } = useSelection()
  const selectionRef = useRef<Selection | undefined>(selection)
  selectionRef.current = selection

  return useCallback(
    async <T>(action: () => Promise<T> | T): Promise<T> => {
      const previousSelection = cloneSelection(selectionRef.current)

      try {
        return await action()
      } finally {
        const currentSelection = selectionRef.current
        const shouldRestore =
          previousSelection !== undefined &&
          !selectionsEqual(currentSelection, previousSelection)

        if (shouldRestore) {
          try {
            await setSelection(previousSelection, false, false)
          } catch (restoreError) {
            logger.warn('[useSelectionPreserver] Failed to restore selection', restoreError)
          }
        }
      }
    },
    [setSelection]
  )
}
