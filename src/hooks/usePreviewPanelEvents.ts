import { useCallback, useEffect, useMemo } from 'react'
import { listenUiEvent, UiEvent } from '../common/uiEvents'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { rightPanelCollapsedAtom, rightPanelLastExpandedSizeAtom, rightPanelSizesAtom } from '../store/atoms/layout'
import { rightPanelTabAtom } from '../store/atoms/rightPanelTab'
import { validatePanelPercentage } from '../utils/panel'

export function usePreviewPanelEvents() {
  const setCollapsed = useSetAtom(rightPanelCollapsedAtom)
  const setTab = useSetAtom(rightPanelTabAtom)
  const [rightSizes, setRightSizes] = useAtom(rightPanelSizesAtom)
  const lastExpanded = useAtomValue(rightPanelLastExpandedSizeAtom)

  const expandedPercent = useMemo(() => validatePanelPercentage(typeof lastExpanded === 'number' ? lastExpanded.toString() : null, 30), [lastExpanded])

  const ensureExpandedSizes = useCallback(() => {
    const hasWidth = Array.isArray(rightSizes) && Number(rightSizes[1]) > 0
    if (hasWidth) return
    const next: [number, number] = [100 - expandedPercent, expandedPercent]
    void setRightSizes(next)
  }, [expandedPercent, rightSizes, setRightSizes])

  useEffect(() => {
    const cleanup = listenUiEvent(UiEvent.OpenPreviewPanel, () => {
      ensureExpandedSizes()
      void setCollapsed(false)
      void setTab('preview')
    })

    return () => {
      cleanup()
    }
  }, [ensureExpandedSizes, setCollapsed, setTab])
}
