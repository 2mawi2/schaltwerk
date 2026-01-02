import { useState, useEffect, useCallback, useMemo } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { VscRefresh, VscGlobe, VscArrowRight, VscChevronLeft, VscChevronRight, VscLinkExternal, VscInspect } from 'react-icons/vsc'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import {
  previewStateAtom,
  setPreviewUrlActionAtom,
  adjustPreviewZoomActionAtom,
  resetPreviewZoomActionAtom,
  navigatePreviewHistoryActionAtom,
  isElementPickerActiveAtom,
  setElementPickerActiveActionAtom,
  PREVIEW_ZOOM_STEP,
  PREVIEW_MIN_ZOOM,
  PREVIEW_MAX_ZOOM
} from '../../store/atoms/preview'
import { getPreviewWebviewLabel } from '../../features/preview/previewIframeRegistry'
import { mountIframe, refreshIframe, setIframeUrl, setPreviewZoom, unmountIframe } from '../../features/preview/previewIframeRegistry'
import { useKeyboardShortcutsConfig } from '../../contexts/KeyboardShortcutsContext'
import { detectPlatformSafe, isShortcutForAction } from '../../keyboardShortcuts/helpers'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { emitUiEvent, UiEvent } from '../../common/uiEvents'
import { logger } from '../../utils/logger'
import { useModal } from '../../contexts/ModalContext'

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

const isTestEnv = typeof process !== 'undefined' && process.env.NODE_ENV === 'test'

export const WebPreviewPanel = ({ previewKey, isResizing = false }: WebPreviewPanelProps) => {
  const getPreviewState = useAtom(previewStateAtom)[0]
  const getIsElementPickerActive = useAtom(isElementPickerActiveAtom)[0]
  const setPreviewUrl = useSetAtom(setPreviewUrlActionAtom)
  const adjustZoom = useSetAtom(adjustPreviewZoomActionAtom)
  const resetZoom = useSetAtom(resetPreviewZoomActionAtom)
  const navigateHistory = useSetAtom(navigatePreviewHistoryActionAtom)
  const setElementPickerActive = useSetAtom(setElementPickerActiveActionAtom)

  const previewState = getPreviewState(previewKey)
  const { url: currentUrl, zoom, history, historyIndex } = previewState
  const hasUrl = Boolean(currentUrl)
  const isPickerActive = getIsElementPickerActive(previewKey)

  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null)
  const { config: keyboardShortcutConfig } = useKeyboardShortcutsConfig()
  const { isAnyModalOpen } = useModal()
  const platform = useMemo(() => detectPlatformSafe(), [])

  useEffect(() => {
    setInputValue(currentUrl ?? '')
  }, [currentUrl])

  const modalOpen = isAnyModalOpen()

  useEffect(() => {
    if (!hostElement || !currentUrl || isResizing || modalOpen) {
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
  }, [previewKey, currentUrl, hostElement, isResizing, modalOpen])

  useEffect(() => {
    if (!currentUrl) return
    setPreviewZoom(previewKey, zoom)
  }, [previewKey, zoom, currentUrl])

  useEffect(() => {
    if (!hostElement || !currentUrl || isResizing || modalOpen) return

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
  }, [previewKey, currentUrl, hostElement, isResizing, modalOpen])

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

  const handleOpenInBrowser = useCallback(async () => {
    try {
      if (!currentUrl) return
      await invoke(TauriCommands.OpenExternalUrl, { url: currentUrl })
    } catch (err) {
      logger.error('Failed to open preview URL in browser', { error: err })
    }
  }, [currentUrl])

  const webviewLabel = useMemo(() => getPreviewWebviewLabel(previewKey), [previewKey])

  const handleToggleElementPicker = useCallback(async () => {
    if (isTestEnv) return

    try {
      if (isPickerActive) {
        await invoke(TauriCommands.PreviewDisableElementPicker, { label: webviewLabel })
        setElementPickerActive({ key: previewKey, active: false })
      } else {
        await invoke(TauriCommands.PreviewEnableElementPicker, { label: webviewLabel })
        setElementPickerActive({ key: previewKey, active: true })
      }
    } catch (err) {
      logger.error('Failed to toggle element picker', { error: err })
      setElementPickerActive({ key: previewKey, active: false })
    }
  }, [isPickerActive, webviewLabel, previewKey, setElementPickerActive])

  useEffect(() => {
    if (isTestEnv || !isPickerActive) return

    let cancelled = false

    const poll = async () => {
      if (cancelled) return

      try {
        const result = await invoke<{ html: string | null }>(
          TauriCommands.PreviewPollPickedElement,
          { label: webviewLabel }
        )

        if (cancelled) return

        if (result.html) {
          setElementPickerActive({ key: previewKey, active: false })
          const formattedHtml = `\`\`\`html\n${result.html}\n\`\`\`\n\n`
          emitUiEvent(UiEvent.InsertTerminalText, { text: formattedHtml })
          return
        }

        if (!cancelled) {
          setTimeout(() => { void poll() }, 150)
        }
      } catch (err) {
        if (!cancelled) {
          logger.error('Failed to poll element picker', { error: err })
          setTimeout(() => { void poll() }, 500)
        }
      }
    }

    void poll()

    return () => {
      cancelled = true
    }
  }, [isPickerActive, webviewLabel, previewKey, setElementPickerActive])

  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1
  const canZoomOut = zoom > PREVIEW_MIN_ZOOM + 0.001
  const canZoomIn = zoom < PREVIEW_MAX_ZOOM - 0.001

  const handleZoomDelta = useCallback(
    (delta: number) => {
      adjustZoom({ key: previewKey, delta })
    },
    [adjustZoom, previewKey]
  )

  const handleZoomReset = useCallback(() => {
    resetZoom(previewKey)
  }, [resetZoom, previewKey])

  const buttonClass = (disabled?: boolean) =>
    [
      'h-8 w-8 rounded flex items-center justify-center border border-subtle bg-secondary hover:bg-hover transition-colors',
      disabled ? 'opacity-40 cursor-not-allowed hover:bg-secondary' : 'text-secondary'
    ].join(' ')

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex items-center gap-3 border-b border-default px-4 py-3">
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
          <button
            type="button"
            aria-label="Select element"
            className={[
              buttonClass(!hasUrl),
              isPickerActive ? 'ring-2 ring-accent-blue bg-hover' : ''
            ].join(' ')}
            onClick={() => { void handleToggleElementPicker() }}
            disabled={!hasUrl}
            title="Select an element to paste its HTML into the terminal"
          >
            <VscInspect className="text-lg" />
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
            className="flex-1 rounded border border-subtle bg-secondary px-3 py-1.5 text-sm text-primary placeholder-muted focus:outline-none focus:ring-2 focus:ring-accent-blue"
            value={inputValue}
            onChange={handleChange}
            placeholder="Enter URL (e.g. http://localhost:3000)"
            autoComplete="off"
          />
          <button type="submit" className="h-8 w-8 rounded bg-accent-blue flex items-center justify-center text-inverse hover:bg-accent-blue-dark disabled:opacity-40" disabled={!inputValue.trim()} aria-label="Navigate">
            <VscArrowRight className="text-lg" />
          </button>
        </form>
        <div className="flex items-center gap-0.5 border-l border-default pl-2">
          <button
            type="button"
            aria-label="Zoom out"
            className="h-6 w-6 rounded text-secondary hover:text-primary hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent flex items-center justify-center text-xs"
            onClick={() => handleZoomDelta(-PREVIEW_ZOOM_STEP)}
            disabled={!canZoomOut}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            className="px-1 text-xs text-secondary hover:text-accent-blue rounded min-w-[2.5rem] text-center"
            onClick={handleZoomReset}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            className="h-6 w-6 rounded text-secondary hover:text-primary hover:bg-hover disabled:opacity-40 disabled:hover:bg-transparent flex items-center justify-center text-xs"
            onClick={() => handleZoomDelta(PREVIEW_ZOOM_STEP)}
            disabled={!canZoomIn}
          >
            +
          </button>
        </div>
      </div>
      {error && (
        <div className="px-4 py-2 text-xs border-b border-default" role="status" aria-live="polite" style={{ color: 'var(--color-accent-red)' }}>
          {error}
        </div>
      )}
      <div className="flex-1 bg-primary text-muted overflow-hidden">
        {modalOpen ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">Preview paused while dialog is open…</div>
        ) : isResizing ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">Preview paused while resizing…</div>
        ) : hasUrl ? (
          <div className="h-full w-full overflow-hidden" data-preview-zoom={zoom.toFixed(2)}>
            <div ref={setHostElement} className="h-full w-full overflow-hidden" />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <VscGlobe className="text-4xl" style={{ color: 'var(--color-border-strong)' }} />
            <div>
              <p className="text-base font-semibold text-secondary">Browser</p>
              <p className="text-sm text-muted">Enter a URL above to load your preview.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

WebPreviewPanel.displayName = 'WebPreviewPanel'
