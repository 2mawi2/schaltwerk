const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const arraysEqual = (a: [number, number], b: [number, number]) =>
  a.length === b.length && a[0] === b[0] && a[1] === b[1]

/**
 * Clamp and normalize split sizes so they are safe to feed into react-split.
 * Falls back to the provided default when the input is missing/invalid/degenerate.
 */
export function sanitizeSplitSizes(
  input: unknown,
  defaultSizes: [number, number]
): [number, number] {
  if (!Array.isArray(input) || input.length < 2) {
    return defaultSizes
  }

  const raw = input.slice(0, 2).map(v => Number(v))
  if (!isFiniteNumber(raw[0]) || !isFiniteNumber(raw[1])) {
    return defaultSizes
  }

  if (raw[0] <= 0 || raw[1] <= 0) {
    return defaultSizes
  }

  const total = raw[0] + raw[1]
  if (!Number.isFinite(total) || total <= 0) {
    return defaultSizes
  }

  const normalized: [number, number] = [
    Math.max(1, Math.round((raw[0] / total) * 1000) / 10), // keep 0.1% granularity
    Math.max(1, Math.round((raw[1] / total) * 1000) / 10),
  ]

  const normalizedTotal = normalized[0] + normalized[1]
  if (!arraysEqual(normalized, defaultSizes) && normalizedTotal !== 100) {
    // Renormalize precisely to 100 to avoid react-split resizing surprises
    const a = Math.round((normalized[0] / normalizedTotal) * 1000) / 10
    const b = Math.max(1, Math.round((1000 - a * 10)) / 10)
    return [a, b]
  }

  return normalized
}

export function areSizesEqual(a: [number, number], b: [number, number]) {
  return arraysEqual(a, b)
}
