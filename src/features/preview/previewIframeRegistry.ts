const registry = new Map<string, HTMLIFrameElement>()
let cacheHost: HTMLDivElement | null = null
const isTestEnv = typeof process !== 'undefined' && process.env.NODE_ENV === 'test'

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

export const getOrCreateIframe = (key: string): HTMLIFrameElement => {
  let iframe = registry.get(key)
  if (!iframe) {
    iframe = createIframe(key)
    registry.set(key, iframe)
    ensureCacheHost().appendChild(iframe)
  }
  return iframe
}

export const mountIframe = (key: string, host: HTMLElement) => {
  const iframe = getOrCreateIframe(key)
  if (iframe.parentElement !== host) {
    host.appendChild(iframe)
  }
}

export const unmountIframe = (key: string) => {
  const iframe = registry.get(key)
  if (!iframe) return
  const host = ensureCacheHost()
  if (iframe.parentElement !== host) {
    host.appendChild(iframe)
  }
}

export const setIframeUrl = (key: string, url: string) => {
  const iframe = getOrCreateIframe(key)
  if (iframe.src === url) return
  if (isTestEnv) {
    iframe.dataset.previewTestUrl = url
    return
  }
  iframe.src = url
}

export const refreshIframe = (key: string, hard = false) => {
  const iframe = registry.get(key)
  if (!iframe || iframe.src === 'about:blank') return

  if (hard) {
    const currentUrl = iframe.src
    const separator = currentUrl.includes('?') ? '&' : '?'
    iframe.src = `${currentUrl}${separator}__schaltwerk_cache=${Date.now()}`
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
}

export const __resetRegistryForTests = () => {
  registry.clear()
  if (cacheHost) {
    cacheHost.remove()
    cacheHost = null
  }
}
