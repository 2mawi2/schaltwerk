import { useCallback, useEffect, useMemo } from 'react'
import { listenUiEvent, UiEvent } from '../common/uiEvents'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { rightPanelCollapsedAtom, rightPanelLastExpandedSizeAtom, rightPanelSizesAtom } from '../store/atoms/layout'
import { rightPanelTabAtom } from '../store/atoms/rightPanelTab'
import { setPreviewUrlActionAtom } from '../store/atoms/preview'
import { validatePanelPercentage } from '../utils/panel'

export function usePreviewPanelEvents() {
  const setCollapsed = useSetAtom(rightPanelCollapsedAtom)
  const setTab = useSetAtom(rightPanelTabAtom)
  const setPreviewUrl = useSetAtom(setPreviewUrlActionAtom)
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
    const cleanup = listenUiEvent(UiEvent.OpenPreviewPanel, (detail) => {
      ensureExpandedSizes()
      void setCollapsed(false)
      void setTab('preview')
      if (detail.url && detail.previewKey) {
        setPreviewUrl({ key: detail.previewKey, url: detail.url })
      }
    })

    return () => {
      cleanup()
    }
  }, [ensureExpandedSizes, setCollapsed, setTab, setPreviewUrl])
}
