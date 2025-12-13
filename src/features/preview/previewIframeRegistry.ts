import { Webview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { logger } from '../../utils/logger'

type Bounds = { x: number; y: number; width: number; height: number }

const isTestEnv = typeof process !== 'undefined' && process.env.NODE_ENV === 'test'

// --- Test environment: keep iframe behavior for vitest/happy-dom.
const iframeRegistry = new Map<string, HTMLIFrameElement>()
let cacheHost: HTMLDivElement | null = null

const ensureCacheHost = (): HTMLDivElement => {
  if (cacheHost && document.body.contains(cacheHost)) {
    return cacheHost
  }
  cacheHost = document.createElement('div')
  cacheHost.id = 'schaltwerk-preview-cache'
  cacheHost.style.position = 'fixed'
  cacheHost.style.left = '-10000px'
  cacheHost.style.top = '0'
  cacheHost.style.width = '1px'
  cacheHost.style.height = '1px'
  cacheHost.style.overflow = 'hidden'
  cacheHost.style.opacity = '0'
  cacheHost.style.pointerEvents = 'none'
  cacheHost.setAttribute('aria-hidden', 'true')
  document.body.appendChild(cacheHost)
  return cacheHost
}

const createIframe = (key: string): HTMLIFrameElement => {
  const iframe = document.createElement('iframe')
  iframe.dataset.previewKey = key
  iframe.style.width = '100%'
  iframe.style.height = '100%'
  iframe.style.border = '0'
  iframe.setAttribute(
    'sandbox',
    'allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts'
  )
  iframe.src = 'about:blank'
  return iframe
}

const getOrCreateIframe = (key: string): HTMLIFrameElement => {
  let iframe = iframeRegistry.get(key)
  if (!iframe) {
    iframe = createIframe(key)
    iframeRegistry.set(key, iframe)
    ensureCacheHost().appendChild(iframe)
  }
  return iframe
}

// --- Runtime: webview-based preview.
type WebviewEntry = {
  label: string
  webview: Webview | null
  desiredUrl: string | null
  loadedUrl: string | null
  visible: boolean
  bounds: Bounds | null
  zoom: number
  appliedZoom: number | null
  operation: Promise<void>
}

const webviewRegistry = new Map<string, WebviewEntry>()

const fnv1a64 = (input: string): string => {
  let hash = 14695981039346656037n
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index))
    hash = (hash * 1099511628211n) & 0xffffffffffffffffn
  }
  return hash.toString(36)
}

export const getPreviewWebviewLabel = (key: string): string => {
  return `preview-${fnv1a64(key)}`
}

const getOrCreateWebviewEntry = (key: string): WebviewEntry => {
  let entry = webviewRegistry.get(key)
  if (!entry) {
    entry = {
      label: getPreviewWebviewLabel(key),
      webview: null,
      desiredUrl: null,
      loadedUrl: null,
      visible: false,
      bounds: null,
      zoom: 1,
      appliedZoom: null,
      operation: Promise.resolve()
    }
    webviewRegistry.set(key, entry)
  }
  return entry
}

const enqueue = (key: string, task: (entry: WebviewEntry) => Promise<void>) => {
  const entry = getOrCreateWebviewEntry(key)
  entry.operation = entry.operation
    .then(() => task(entry))
    .catch((error) => {
      logger.error('[preview] webview operation failed', { key, label: entry.label, error })
    })
  return entry.operation
}

const readBounds = (host: HTMLElement): Bounds | null => {
  const rect = host.getBoundingClientRect()
  const width = Math.max(0, Math.round(rect.width))
  const height = Math.max(0, Math.round(rect.height))
  if (width <= 0 || height <= 0) return null
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width,
    height
  }
}

const buildCacheBustUrl = (url: string) => {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}__schaltwerk_cache=${Date.now()}`
}

const WEBVIEW_CREATED_EVENT = 'tauri://created'
const WEBVIEW_ERROR_EVENT = 'tauri://error'

const waitForCreated = (webview: Webview) =>
  new Promise<void>((resolve, reject) => {
    void webview.once(WEBVIEW_CREATED_EVENT, () => resolve())
    void webview.once<string>(WEBVIEW_ERROR_EVENT, (event) => reject(new Error(String(event.payload ?? event))))
  })

const ensureWebview = async (entry: WebviewEntry, bounds: Bounds | null, urlToLoad: string, loadedUrl: string, keepHidden: boolean) => {
  if (entry.webview) {
    try {
      await entry.webview.close()
    } catch (error) {
      logger.warn('[preview] Failed to close existing webview', { label: entry.label, error })
    }
  }

  const safeBounds: Bounds = bounds ?? { x: -10000, y: -10000, width: 1, height: 1 }
  const appWindow = getCurrentWindow()
  const webview = new Webview(appWindow, entry.label, {
    url: urlToLoad,
    x: safeBounds.x,
    y: safeBounds.y,
    width: Math.max(1, safeBounds.width),
    height: Math.max(1, safeBounds.height),
    focus: false
  })

  await waitForCreated(webview)

  entry.webview = webview
  entry.loadedUrl = loadedUrl
  entry.bounds = safeBounds
  entry.visible = false
  entry.appliedZoom = entry.zoom

  if (entry.zoom !== 1) {
    await webview.setZoom(entry.zoom)
  }

  if (keepHidden) {
    await webview.hide()
    entry.visible = false
    return
  }

  await webview.show()
  entry.visible = true
}

const applyBoundsAndVisibility = async (entry: WebviewEntry, bounds: Bounds | null, visible: boolean) => {
  const webview = entry.webview
  if (!webview) return

  if (bounds) {
    const hasBounds =
      entry.bounds &&
      entry.bounds.x === bounds.x &&
      entry.bounds.y === bounds.y &&
      entry.bounds.width === bounds.width &&
      entry.bounds.height === bounds.height

    if (!hasBounds) {
      await webview.setPosition(new LogicalPosition(bounds.x, bounds.y))
      await webview.setSize(new LogicalSize(bounds.width, bounds.height))
      entry.bounds = bounds
    }
  }

  if (entry.appliedZoom !== entry.zoom) {
    await webview.setZoom(entry.zoom)
    entry.appliedZoom = entry.zoom
  }

  if (visible && !entry.visible) {
    await webview.show()
    entry.visible = true
  }

  if (!visible && entry.visible) {
    await webview.hide()
    entry.visible = false
  }
}

export const mountIframe = (key: string, host: HTMLElement) => {
  if (isTestEnv) {
    const iframe = getOrCreateIframe(key)
    if (iframe.parentElement !== host) {
      host.appendChild(iframe)
    }
    return
  }

  void enqueue(key, async (entry) => {
    if (!entry.desiredUrl) return
    const bounds = readBounds(host)
    if (!bounds) {
      await applyBoundsAndVisibility(entry, null, false)
      return
    }

    if (!entry.webview || entry.loadedUrl !== entry.desiredUrl) {
      await ensureWebview(entry, bounds, entry.desiredUrl, entry.desiredUrl, false)
      return
    }

    await applyBoundsAndVisibility(entry, bounds, true)
  })
}

export const unmountIframe = (key: string) => {
  if (isTestEnv) {
    const iframe = iframeRegistry.get(key)
    if (!iframe) return
    const host = ensureCacheHost()
    if (iframe.parentElement !== host) {
      host.appendChild(iframe)
    }
    return
  }

  void enqueue(key, async (entry) => {
    await applyBoundsAndVisibility(entry, null, false)
  })
}

export const setIframeUrl = (key: string, url: string) => {
  if (isTestEnv) {
    const iframe = getOrCreateIframe(key)
    if (iframe.src === url) return
    iframe.dataset.previewTestUrl = url
    return
  }

  const entry = getOrCreateWebviewEntry(key)
  entry.desiredUrl = url
}

export const setPreviewZoom = (key: string, zoom: number) => {
  if (isTestEnv) return
  const entry = getOrCreateWebviewEntry(key)
  entry.zoom = zoom
  void enqueue(key, async (inner) => {
    await applyBoundsAndVisibility(inner, inner.bounds, inner.visible)
  })
}

export const refreshIframe = (key: string, hard = false) => {
  if (isTestEnv) {
    const iframe = iframeRegistry.get(key)
    if (!iframe || iframe.src === 'about:blank') return

    if (hard) {
      const currentUrl = iframe.src
      iframe.src = buildCacheBustUrl(currentUrl)
      return
    }

    try {
      iframe.contentWindow?.location.reload()
    } catch {
      const currentUrl = iframe.src
      if (currentUrl && currentUrl !== 'about:blank') {
        iframe.src = currentUrl
      }
    }
    return
  }

  void enqueue(key, async (entry) => {
    if (!entry.desiredUrl) return
    const urlToLoad = hard ? buildCacheBustUrl(entry.desiredUrl) : entry.desiredUrl
    const keepHidden = !entry.visible
    await ensureWebview(entry, entry.bounds, urlToLoad, entry.desiredUrl, keepHidden)
    await applyBoundsAndVisibility(entry, entry.bounds, !keepHidden)
  })
}

export const __resetRegistryForTests = () => {
  iframeRegistry.clear()
  if (cacheHost) {
    cacheHost.remove()
    cacheHost = null
  }

  void Promise.all(
    Array.from(webviewRegistry.values()).map(async (entry) => {
      try {
        await entry.webview?.close()
      } catch (error) {
        logger.debug('[preview] Failed to close webview during reset', { label: entry.label, error })
      }
    })
  )
  webviewRegistry.clear()
}
