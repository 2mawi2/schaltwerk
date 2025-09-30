/// <reference lib="webworker" />
import hljs from 'highlight.js'

export interface SyntaxHighlightRequest {
  id: number
  code: string
  language?: string | null
  autoDetect?: boolean
}

export interface SyntaxHighlightResponse {
  id: number
  result: string
  error?: string
}

declare const self: DedicatedWorkerGlobalScope

self.onmessage = (event: MessageEvent<SyntaxHighlightRequest>) => {
  const { id, code, language, autoDetect } = event.data

  if (typeof id !== 'number') {
    return
  }

  if (!code) {
    self.postMessage({ id, result: '' } satisfies SyntaxHighlightResponse)
    return
  }

  try {
    const shouldAutoDetect = autoDetect ?? true
    let result = code

    if (language && hljs.getLanguage(language)) {
      result = hljs.highlight(code, { language, ignoreIllegals: true }).value
    } else if (shouldAutoDetect) {
      result = hljs.highlightAuto(code).value
    }

    self.postMessage({ id, result } satisfies SyntaxHighlightResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown highlight error'
    self.postMessage({ id, result: code, error: message } satisfies SyntaxHighlightResponse)
  }
}

export {}
