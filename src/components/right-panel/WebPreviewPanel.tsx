import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { VscRefresh, VscGlobe, VscArrowRight, VscChevronLeft, VscChevronRight, VscSearch, VscLinkExternal } from 'react-icons/vsc'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import {
  previewStateAtom,
  setPreviewUrlActionAtom,
  adjustPreviewZoomActionAtom,
  resetPreviewZoomActionAtom,
  navigatePreviewHistoryActionAtom,
  PREVIEW_ZOOM_STEP,
  PREVIEW_MIN_ZOOM,
  PREVIEW_MAX_ZOOM
} from '../../store/atoms/preview'
import { mountIframe, refreshIframe, setIframeUrl, setPreviewZoom, unmountIframe } from '../../features/preview/previewIframeRegistry'
import { useKeyboardShortcutsConfig } from '../../contexts/KeyboardShortcutsContext'
import { detectPlatformSafe, isShortcutForAction } from '../../keyboardShortcuts/helpers'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { logger } from '../../utils/logger'

interface WebPreviewPanelProps {
  previewKey: string
  isResizing?: boolean
}

const normalizeUrl = (input: string): string | null => {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  if (/^\d+$/.test(trimmed)) {
    return `http://localhost:${trimmed}`
  }

  if (/^localhost/i.test(trimmed)) {
    return `http://${trimmed}`
  }

  if (/^[0-9.]+(:\d+)?(\/.*)?$/.test(trimmed) || /^[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(trimmed)) {
    return `http://${trimmed}`
  }

  return null
}

export const WebPreviewPanel = ({ previewKey, isResizing = false }: WebPreviewPanelProps) => {
  const getPreviewState = useAtom(previewStateAtom)[0]
  const setPreviewUrl = useSetAtom(setPreviewUrlActionAtom)
  const adjustZoom = useSetAtom(adjustPreviewZoomActionAtom)
  const resetZoom = useSetAtom(resetPreviewZoomActionAtom)
  const navigateHistory = useSetAtom(navigatePreviewHistoryActionAtom)

  const previewState = getPreviewState(previewKey)
  const { url: currentUrl, zoom, history, historyIndex } = previewState
  const hasUrl = Boolean(currentUrl)

  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null)
  const [showZoomPopover, setShowZoomPopover] = useState(false)
  const zoomControlRef = useRef<HTMLDivElement | null>(null)
  const { config: keyboardShortcutConfig } = useKeyboardShortcutsConfig()
  const platform = useMemo(() => detectPlatformSafe(), [])

  useEffect(() => {
    setInputValue(currentUrl ?? '')
  }, [currentUrl])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!zoomControlRef.current) return
      if (!zoomControlRef.current.contains(event.target as Node)) {
        setShowZoomPopover(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowZoomPopover(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    if (!hostElement || !currentUrl || isResizing) {
      if (hostElement && currentUrl) {
        unmountIframe(previewKey)
      }
      return
    }

    setIframeUrl(previewKey, currentUrl)
    mountIframe(previewKey, hostElement)

    return () => {
      unmountIframe(previewKey)
    }
  }, [previewKey, currentUrl, hostElement, isResizing])

  useEffect(() => {
    if (!currentUrl) return
    setPreviewZoom(previewKey, zoom)
  }, [previewKey, zoom, currentUrl])

  useEffect(() => {
    if (!hostElement || !currentUrl || isResizing) return

    const updateBounds = () => {
      mountIframe(previewKey, hostElement)
    }

    updateBounds()

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          updateBounds()
        })
    resizeObserver?.observe(hostElement)
    window.addEventListener('resize', updateBounds)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateBounds)
    }
  }, [previewKey, currentUrl, hostElement, isResizing])

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const normalized = normalizeUrl(inputValue)
      if (!normalized) {
        setError('Enter a valid http(s) URL, hostname, or port.')
        return
      }
      setError(null)
      setPreviewUrl({ key: previewKey, url: normalized })
    },
    [inputValue, previewKey, setPreviewUrl]
  )

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value)
  }, [])

  const handleRefresh = useCallback(
    (hard = false) => {
      refreshIframe(previewKey, hard)
    },
    [previewKey]
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isShortcutForAction(event, KeyboardShortcutAction.IncreaseFontSize, keyboardShortcutConfig, { platform })) {
        event.preventDefault()
        event.stopPropagation()
        adjustZoom({ key: previewKey, delta: PREVIEW_ZOOM_STEP })
        return
      }

      if (isShortcutForAction(event, KeyboardShortcutAction.DecreaseFontSize, keyboardShortcutConfig, { platform })) {
        event.preventDefault()
        event.stopPropagation()
        adjustZoom({ key: previewKey, delta: -PREVIEW_ZOOM_STEP })
        return
      }

      if (isShortcutForAction(event, KeyboardShortcutAction.ResetFontSize, keyboardShortcutConfig, { platform })) {
        event.preventDefault()
        event.stopPropagation()
        resetZoom(previewKey)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [adjustZoom, resetZoom, previewKey, keyboardShortcutConfig, platform])

  const handleNavigate = useCallback(
    (direction: -1 | 1) => {
      navigateHistory({ key: previewKey, direction })
    },
    [previewKey, navigateHistory]
  )

  const handleZoomDelta = useCallback(
    (delta: number) => {
      adjustZoom({ key: previewKey, delta })
    },
    [adjustZoom, previewKey]
  )

  const handleZoomReset = useCallback(() => {
    resetZoom(previewKey)
  }, [resetZoom, previewKey])

  const handleZoomButtonToggle = useCallback(() => {
    setShowZoomPopover(value => !value)
  }, [])

  const handleOpenInBrowser = useCallback(async () => {
    try {
      if (!currentUrl) return
      await invoke(TauriCommands.OpenExternalUrl, { url: currentUrl })
    } catch (err) {
      logger.error('Failed to open preview URL in browser', { error: err })
    }
  }, [currentUrl])

  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1
  const canZoomOut = zoom > PREVIEW_MIN_ZOOM + 0.001
  const canZoomIn = zoom < PREVIEW_MAX_ZOOM - 0.001

  const buttonClass = (disabled?: boolean) =>
    [
      'h-8 w-8 rounded flex items-center justify-center border border-slate-700 bg-slate-900 hover:bg-slate-800 transition-colors',
      disabled ? 'opacity-40 cursor-not-allowed hover:bg-slate-900' : 'text-slate-200'
    ].join(' ')

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Back" className={buttonClass(!canGoBack)} onClick={() => handleNavigate(-1)} disabled={!canGoBack}>
            <VscChevronLeft className="text-lg" />
          </button>
          <button type="button" aria-label="Forward" className={buttonClass(!canGoForward)} onClick={() => handleNavigate(1)} disabled={!canGoForward}>
            <VscChevronRight className="text-lg" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Hard reload" className={buttonClass(!hasUrl)} onClick={() => handleRefresh(true)} disabled={!hasUrl} title="Hard reload (clears cache)">
            <VscRefresh className="text-lg" />
          </button>
          <button type="button" aria-label="Open in browser" className={buttonClass(!hasUrl)} onClick={() => { void handleOpenInBrowser() }} disabled={!hasUrl} title="Open in browser (for DevTools/logs)">
            <VscLinkExternal className="text-lg" />
          </button>
        </div>
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex items-center gap-2"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <label htmlFor="preview-url-input" className="sr-only">
            Preview URL
          </label>
          <input
            id="preview-url-input"
            className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            value={inputValue}
            onChange={handleChange}
            placeholder="Enter URL (e.g. http://localhost:3000)"
            autoComplete="off"
          />
          <div className="relative" ref={zoomControlRef}>
            <button
              type="button"
              aria-label="Adjust zoom"
              className="h-8 w-8 rounded border border-slate-700 bg-slate-900 flex items-center justify-center text-slate-200 hover:bg-slate-800"
              onClick={handleZoomButtonToggle}
            >
              <VscSearch />
            </button>
            {showZoomPopover && (
              <div className="absolute right-0 mt-2 w-48 rounded-md border border-slate-700 bg-slate-900 shadow-2xl z-10">
                <div className="flex items-center justify-between px-3 py-2 text-sm text-slate-100">
                  <span className="font-semibold">{Math.round(zoom * 100)}%</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Zoom out"
                      className="h-7 w-7 rounded-full border border-slate-600 text-slate-100 disabled:opacity-40"
                      onClick={() => handleZoomDelta(-PREVIEW_ZOOM_STEP)}
                      disabled={!canZoomOut}
                    >
                      &minus;
                    </button>
                    <button
                      type="button"
                      aria-label="Zoom in"
                      className="h-7 w-7 rounded-full border border-slate-600 text-slate-100 disabled:opacity-40"
                      onClick={() => handleZoomDelta(PREVIEW_ZOOM_STEP)}
                      disabled={!canZoomIn}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="border-t border-slate-800" />
                <button
                  type="button"
                  className="w-full px-3 py-2 text-sm font-medium text-cyan-300 hover:bg-slate-800"
                  onClick={handleZoomReset}
                >
                  Reset
                </button>
              </div>
            )}
          </div>
          <button type="submit" className="h-8 w-8 rounded bg-cyan-600 flex items-center justify-center text-slate-900 hover:bg-cyan-500 disabled:opacity-40" disabled={!inputValue.trim()} aria-label="Navigate">
            <VscArrowRight className="text-lg" />
          </button>
        </form>
      </div>
      {error && (
        <div className="px-4 py-2 text-xs text-red-400 border-b border-slate-800" role="status" aria-live="polite">
          {error}
        </div>
      )}
      <div className="flex-1 bg-slate-950 text-slate-400 overflow-hidden">
        {isResizing ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">Preview paused while resizing…</div>
        ) : hasUrl ? (
          <div className="h-full w-full overflow-hidden" data-preview-zoom={zoom.toFixed(2)}>
            <div ref={setHostElement} className="h-full w-full overflow-hidden" />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <VscGlobe className="text-4xl text-slate-600" />
            <div>
              <p className="text-base font-semibold text-slate-200">Browser</p>
              <p className="text-sm text-slate-500">Enter a URL above to load your preview.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

WebPreviewPanel.displayName = 'WebPreviewPanel'
