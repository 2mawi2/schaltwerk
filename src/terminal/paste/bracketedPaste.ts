const ESC = '\x1b'

export const BRACKETED_PASTE_PREFIX = `${ESC}[200~`
export const BRACKETED_PASTE_SUFFIX = `${ESC}[201~`

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff
}

function slicePreservingSurrogates(text: string, start: number, end: number): string {
  const length = text.length
  let safeEnd = Math.min(end, length)

  if (safeEnd <= start) {
    safeEnd = Math.min(start + 1, length)
  }

  if (safeEnd < length && safeEnd > start) {
    const prev = text.charCodeAt(safeEnd - 1)
    const next = text.charCodeAt(safeEnd)
    // JS strings are UTF-16. Emoji and some symbols are encoded as surrogate pairs (high + low).
    // If we split between them while chunking, we'd send invalid Unicode to the PTY.
    if (isHighSurrogate(prev) && isLowSurrogate(next)) {
      safeEnd -= 1
      if (safeEnd <= start) {
        safeEnd = Math.min(start + 2, length)
      }
    }
  }

  return text.slice(start, safeEnd)
}

export function buildBracketedPasteChunks(text: string, chunkSize = 60_000): string[] {
  const normalizedChunkSize = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : 60_000
  const chunks: string[] = [BRACKETED_PASTE_PREFIX]

  // Send large pastes in chunks to avoid oversized frames in the frontend→backend transport while
  // still presenting a single "bracketed paste" boundary to programs reading stdin.
  for (let offset = 0; offset < text.length;) {
    const chunk = slicePreservingSurrogates(text, offset, offset + normalizedChunkSize)
    if (chunk.length === 0) {
      break
    }
    chunks.push(chunk)
    offset += chunk.length
  }

  chunks.push(BRACKETED_PASTE_SUFFIX)
  return chunks
}
