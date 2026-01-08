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
import { useTranslation } from '../../common/i18n'

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
  const { t } = useTranslation()
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
        setError(t.webPreview.invalidUrl)
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
      'h-8 w-8 rounded flex items-center justify-center border border-slate-700 bg-slate-900 hover:bg-slate-800 transition-colors',
      disabled ? 'opacity-40 cursor-not-allowed hover:bg-slate-900' : 'text-slate-200'
    ].join(' ')

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t.webPreview.back} className={buttonClass(!canGoBack)} onClick={() => handleNavigate(-1)} disabled={!canGoBack}>
            <VscChevronLeft className="text-lg" />
          </button>
          <button type="button" aria-label={t.webPreview.forward} className={buttonClass(!canGoForward)} onClick={() => handleNavigate(1)} disabled={!canGoForward}>
            <VscChevronRight className="text-lg" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={t.webPreview.hardReload} className={buttonClass(!hasUrl)} onClick={() => handleRefresh(true)} disabled={!hasUrl} title={t.webPreview.hardReloadTitle}>
            <VscRefresh className="text-lg" />
          </button>
          <button type="button" aria-label={t.webPreview.openInBrowser} className={buttonClass(!hasUrl)} onClick={() => { void handleOpenInBrowser() }} disabled={!hasUrl} title={t.webPreview.openInBrowserTitle}>
            <VscLinkExternal className="text-lg" />
          </button>
          <button
            type="button"
            aria-label={t.webPreview.selectElement}
            className={[
              buttonClass(!hasUrl),
              isPickerActive ? 'ring-2 ring-cyan-500 bg-slate-800' : ''
            ].join(' ')}
            onClick={() => { void handleToggleElementPicker() }}
            disabled={!hasUrl}
            title={t.webPreview.selectElementTitle}
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
            {t.webPreview.previewUrl}
          </label>
          <input
            id="preview-url-input"
            className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            value={inputValue}
            onChange={handleChange}
            placeholder={t.webPreview.urlPlaceholder}
            autoComplete="off"
          />
          <button type="submit" className="h-8 w-8 rounded bg-cyan-600 flex items-center justify-center text-slate-900 hover:bg-cyan-500 disabled:opacity-40" disabled={!inputValue.trim()} aria-label={t.webPreview.navigate}>
            <VscArrowRight className="text-lg" />
          </button>
        </form>
        <div className="flex items-center gap-0.5 border-l border-slate-700 pl-2">
          <button
            type="button"
            aria-label={t.webPreview.zoomOut}
            className="h-6 w-6 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent flex items-center justify-center text-xs"
            onClick={() => handleZoomDelta(-PREVIEW_ZOOM_STEP)}
            disabled={!canZoomOut}
          >
            −
          </button>
          <button
            type="button"
            aria-label={t.webPreview.resetZoom}
            className="px-1 text-xs text-slate-400 hover:text-cyan-300 rounded min-w-[2.5rem] text-center"
            onClick={handleZoomReset}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            aria-label={t.webPreview.zoomIn}
            className="h-6 w-6 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent flex items-center justify-center text-xs"
            onClick={() => handleZoomDelta(PREVIEW_ZOOM_STEP)}
            disabled={!canZoomIn}
          >
            +
          </button>
        </div>
      </div>
      {error && (
        <div className="px-4 py-2 text-xs text-red-400 border-b border-slate-800" role="status" aria-live="polite">
          {error}
        </div>
      )}
      <div className="flex-1 bg-slate-950 text-slate-400 overflow-hidden">
        {modalOpen ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">{t.webPreview.pausedDialog}</div>
        ) : isResizing ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-400">{t.webPreview.pausedResizing}</div>
        ) : hasUrl ? (
          <div className="h-full w-full overflow-hidden" data-preview-zoom={zoom.toFixed(2)}>
            <div ref={setHostElement} className="h-full w-full overflow-hidden" />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <VscGlobe className="text-4xl text-slate-600" />
            <div>
              <p className="text-base font-semibold text-slate-200">{t.webPreview.browserTitle}</p>
              <p className="text-sm text-slate-500">{t.webPreview.browserHint}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

WebPreviewPanel.displayName = 'WebPreviewPanel'
