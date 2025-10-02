const CLASS_NAME = 'is-split-dragging'

const sourceCounts = new Map<string, number>()
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
}

function normalizeSource(source: string): string {
  return source && source.trim().length > 0 ? source : 'unknown'
}

function decrementSource(source: string) {
  const current = sourceCounts.get(source)
  if (current === undefined) {
    return
  }

  if (current <= 1) {
    sourceCounts.delete(source)
  } else {
    sourceCounts.set(source, current - 1)
  }
}

export function beginSplitDrag(source = 'unknown'): void {
  const doc = ensureDocument()
  if (!doc) return

  const normalized = normalizeSource(source)

  totalActive += 1
  sourceCounts.set(normalized, (sourceCounts.get(normalized) ?? 0) + 1)

  if (totalActive === 1) {
    applyClass(doc)
  }
}

export function endSplitDrag(source = 'unknown'): void {
  const doc = ensureDocument()
  if (!doc) return

  const normalized = normalizeSource(source)

  const current = sourceCounts.get(normalized)

  if (current && current > 0) {
    if (totalActive > 0) {
      totalActive -= 1
    }
    decrementSource(normalized)
  } else {
    if (sourceCounts.size > 0) {
      // There are other active sources; ignore unmatched release to avoid false clears
      return
    }

    if (totalActive > 0) {
      totalActive -= 1
    }
  }

  if (totalActive <= 0) {
    totalActive = 0
    sourceCounts.clear()
    removeClass(doc)
    return
  }

  if (sourceCounts.size === 0) {
    removeClass(doc)
  }
}

export function isSplitDragActive(): boolean {
  return totalActive > 0
}

export function resetSplitDragForTests(): void {
  totalActive = 0
  sourceCounts.clear()
  const doc = ensureDocument()
  if (!doc) return
  removeClass(doc)
}
