import { atom } from 'jotai'

export interface PreviewState {
  url: string | null
  zoom: number
  history: string[]
  historyIndex: number
}

const previewStatesAtom = atom<Map<string, PreviewState>>(new Map())

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1
const DEFAULT_ZOOM = 1

export const PREVIEW_MIN_ZOOM = MIN_ZOOM
export const PREVIEW_MAX_ZOOM = MAX_ZOOM

export const buildPreviewKey = (projectPath: string, scope: 'session' | 'orchestrator', sessionId?: string): string => {
  if (scope === 'session' && sessionId) {
    return `${projectPath}::session::${sessionId}`
  }
  return `${projectPath}::orchestrator`
}

export const previewStateAtom = atom(
  (get) => (key: string): PreviewState => {
    const states = get(previewStatesAtom)
    return states.get(key) ?? { url: null, zoom: DEFAULT_ZOOM, history: [], historyIndex: -1 }
  }
)

export const setPreviewUrlActionAtom = atom(
  null,
  (get, set, payload: { key: string; url: string | null }) => {
    const states = get(previewStatesAtom)
    const current = states.get(payload.key) ?? { url: null, zoom: DEFAULT_ZOOM, history: [], historyIndex: -1 }
    const updated = new Map(states)

    if (payload.url) {
      const trimmedHistory = current.historyIndex >= 0 ? current.history.slice(0, current.historyIndex + 1) : []
      const newHistory = [...trimmedHistory, payload.url]
      updated.set(payload.key, {
        ...current,
        url: payload.url,
        history: newHistory,
        historyIndex: newHistory.length - 1
      })
    } else {
      updated.set(payload.key, { ...current, url: payload.url })
    }

    set(previewStatesAtom, updated)
  }
)

export const navigatePreviewHistoryActionAtom = atom(
  null,
  (get, set, payload: { key: string; direction: -1 | 1 }) => {
    const states = get(previewStatesAtom)
    const current = states.get(payload.key) ?? { url: null, zoom: DEFAULT_ZOOM, history: [], historyIndex: -1 }
    const newIndex = current.historyIndex + payload.direction

    if (newIndex >= 0 && newIndex < current.history.length) {
      const updated = new Map(states)
      updated.set(payload.key, {
        ...current,
        url: current.history[newIndex],
        historyIndex: newIndex
      })
      set(previewStatesAtom, updated)
    }
  }
)

export const adjustPreviewZoomActionAtom = atom(
  null,
  (get, set, payload: { key: string; delta: number }) => {
    const states = get(previewStatesAtom)
    const current = states.get(payload.key) ?? { url: null, zoom: DEFAULT_ZOOM, history: [], historyIndex: -1 }
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, parseFloat((current.zoom + payload.delta).toFixed(2))))
    const updated = new Map(states)
    updated.set(payload.key, { ...current, zoom: newZoom })
    set(previewStatesAtom, updated)
  }
)

export const resetPreviewZoomActionAtom = atom(
  null,
  (get, set, key: string) => {
    const states = get(previewStatesAtom)
    const current = states.get(key) ?? { url: null, zoom: DEFAULT_ZOOM, history: [], historyIndex: -1 }
    const updated = new Map(states)
    updated.set(key, { ...current, zoom: DEFAULT_ZOOM })
    set(previewStatesAtom, updated)
  }
)

export const PREVIEW_ZOOM_STEP = ZOOM_STEP
