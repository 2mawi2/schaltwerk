export function hashSegments(segments: string[]): string {
  if (segments.length === 0) {
    return '0'
  }

  let hash = 0

  for (const segment of segments) {
    for (let index = 0; index < segment.length; index++) {
      hash = Math.imul(31, hash) ^ segment.charCodeAt(index)
    }

    hash = Math.imul(31, hash) ^ 0x7f
  }

  return (hash >>> 0).toString(36)
}
