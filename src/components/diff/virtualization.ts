export function computeRenderOrder(
  previous: string[],
  prioritizedVisible: string[],
  limit: number
): string[] {
  if (limit <= 0) {
    return []
  }

  const next: string[] = []
  const seen = new Set<string>()

  for (const path of prioritizedVisible) {
    if (seen.has(path)) {
      continue
    }
    next.push(path)
    seen.add(path)
    if (next.length === limit) {
      return next
    }
  }

  for (const path of previous) {
    if (seen.has(path)) {
      continue
    }
    next.push(path)
    seen.add(path)
    if (next.length === limit) {
      break
    }
  }

  return next
}
