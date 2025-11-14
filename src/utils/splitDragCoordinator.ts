const CLASS_NAME = 'is-split-dragging'
const ORIENTATION_ATTRIBUTE = 'data-split-orientation'

type DragOrientation = 'row' | 'col'

interface SourceEntry {
  count: number
  orientations: DragOrientation[]
}

const sourceEntries = new Map<string, SourceEntry>()
const orientationTotals: Record<DragOrientation, number> = {
  row: 0,
  col: 0
}
let totalActive = 0

function ensureDocument(): Document | null {
  if (typeof document === 'undefined') {
    return null
  }
  return document
}

function applyClass(doc: Document) {
  doc.body.classList.add(CLASS_NAME)
}

function removeClass(doc: Document) {
  doc.body.classList.remove(CLASS_NAME)
  doc.body.removeAttribute(ORIENTATION_ATTRIBUTE)
}

function normalizeSource(source: string): string {
  return source && source.trim().length > 0 ? source : 'unknown'
}

function updateOrientationAttribute(doc: Document) {
  if (totalActive <= 0) {
    removeClass(doc)
    return
  }

  applyClass(doc)

  const rowActive = orientationTotals.row > 0
  const colActive = orientationTotals.col > 0

  if (rowActive && colActive) {
    doc.body.setAttribute(ORIENTATION_ATTRIBUTE, 'mixed')
  } else if (rowActive) {
    doc.body.setAttribute(ORIENTATION_ATTRIBUTE, 'row')
  } else if (colActive) {
    doc.body.setAttribute(ORIENTATION_ATTRIBUTE, 'col')
  } else {
    doc.body.removeAttribute(ORIENTATION_ATTRIBUTE)
  }
}

export function beginSplitDrag(source = 'unknown', options?: { orientation?: DragOrientation }): void {
  const doc = ensureDocument()
  if (!doc) return

  const normalized = normalizeSource(source)
  const orientation: DragOrientation = options?.orientation ?? 'row'

  totalActive += 1
  const entry = sourceEntries.get(normalized)
  if (entry) {
    entry.count += 1
    entry.orientations.push(orientation)
  } else {
    sourceEntries.set(normalized, { count: 1, orientations: [orientation] })
  }
  orientationTotals[orientation] += 1

  updateOrientationAttribute(doc)
}

export function endSplitDrag(source = 'unknown'): void {
  const doc = ensureDocument()
  if (!doc) return

  const normalized = normalizeSource(source)
  const entry = sourceEntries.get(normalized)
  let releasedOrientation: DragOrientation | undefined

  if (entry && entry.count > 0) {
    entry.count -= 1
    releasedOrientation = entry.orientations.pop() ?? releasedOrientation

    if (entry.count <= 0 || entry.orientations.length === 0) {
      sourceEntries.delete(normalized)
    }

    if (totalActive > 0) {
      totalActive -= 1
    }
  } else {
    if (sourceEntries.size > 0) {
      // There are other active sources; ignore unmatched release to avoid false clears
      return
    }

    if (totalActive > 0) {
      totalActive -= 1
    }
  }

  if (releasedOrientation) {
    orientationTotals[releasedOrientation] = Math.max(0, orientationTotals[releasedOrientation] - 1)
  }

  if (totalActive <= 0) {
    totalActive = 0
    sourceEntries.clear()
    orientationTotals.row = 0
    orientationTotals.col = 0
    removeClass(doc)
    return
  }

  updateOrientationAttribute(doc)
}

export function isSplitDragActive(): boolean {
  return totalActive > 0
}

export function resetSplitDragForTests(): void {
  totalActive = 0
  sourceEntries.clear()
  orientationTotals.row = 0
  orientationTotals.col = 0
  const doc = ensureDocument()
  if (!doc) return
  removeClass(doc)
}
