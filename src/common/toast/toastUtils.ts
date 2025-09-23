export function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `toast-${Math.random().toString(36).slice(2, 10)}`
}

interface ToastEntry {
  id: string
  tone: 'success' | 'warning' | 'error'
  title: string
  description?: string
  durationMs?: number
}

export function calculateToastOverflow(toasts: ToastEntry[], maxToasts: number): { toasts: ToastEntry[], removedIds: string[] } {
  const next = [...toasts]
  const overflow = next.length - maxToasts
  const removedIds: string[] = []

  if (overflow > 0) {
    const trimmed = next.slice(overflow)
    next.slice(0, overflow).forEach((toast) => removedIds.push(toast.id))
    return { toasts: trimmed, removedIds }
  }

  return { toasts: next, removedIds }
}