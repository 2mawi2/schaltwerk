/// <reference lib="webworker" />
import hljs from 'highlight.js'
import { splitHighlightedLines } from '../utils/splitHighlightedLines'

interface SyntaxHighlightRequestBase {
  id: number
  language?: string | null
  autoDetect?: boolean
}

export interface SyntaxHighlightSingleRequest extends SyntaxHighlightRequestBase {
  type: 'single'
  code: string
}

export interface SyntaxHighlightBlockRequest extends SyntaxHighlightRequestBase {
  type: 'block'
  lines: string[]
}

export type SyntaxHighlightRequest = SyntaxHighlightSingleRequest | SyntaxHighlightBlockRequest

interface SyntaxHighlightResponseBase {
  id: number
  error?: string
}

export interface SyntaxHighlightSingleResponse extends SyntaxHighlightResponseBase {
  type: 'single'
  result: string
}

export interface SyntaxHighlightBlockResponse extends SyntaxHighlightResponseBase {
  type: 'block'
  result: string[]
}

export type SyntaxHighlightResponse = SyntaxHighlightSingleResponse | SyntaxHighlightBlockResponse

declare const self: DedicatedWorkerGlobalScope

self.onmessage = (event: MessageEvent<SyntaxHighlightRequest>) => {
  const { id, language, autoDetect } = event.data

  if (typeof id !== 'number') {
    return
  }

  const highlightChunk = (code: string) => {
    if (!code) return ''

    const shouldAutoDetect = autoDetect ?? true

    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value
    }

    if (shouldAutoDetect) {
      return hljs.highlightAuto(code).value
    }

    return code
  }

  if (event.data.type === 'single') {
    const { code } = event.data

    if (!code) {
      self.postMessage({ id, type: 'single', result: '' } satisfies SyntaxHighlightSingleResponse)
      return
    }

    try {
      const result = highlightChunk(code)
      self.postMessage({ id, type: 'single', result } satisfies SyntaxHighlightSingleResponse)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown highlight error'
      self.postMessage({ id, type: 'single', result: code, error: message } satisfies SyntaxHighlightSingleResponse)
    }
    return
  }

  const { lines } = event.data

  if (!Array.isArray(lines) || lines.length === 0) {
    self.postMessage({ id, type: 'block', result: [] } satisfies SyntaxHighlightBlockResponse)
    return
  }

  const original = lines.slice()

  try {
    const highlighted = highlightChunk(lines.join('\n'))
    let split = splitHighlightedLines(highlighted)

    if (split.length !== original.length) {
      if (split.length > original.length) {
        split = split.slice(0, original.length)
      } else {
        split = split.concat(original.slice(split.length))
      }
    }

    self.postMessage({ id, type: 'block', result: split } satisfies SyntaxHighlightBlockResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown highlight error'
    self.postMessage({ id, type: 'block', result: original, error: message } satisfies SyntaxHighlightBlockResponse)
  }
}

export {}
