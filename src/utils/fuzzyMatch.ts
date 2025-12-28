export function fuzzyMatch(text: string, pattern: string): boolean {
  const lowerText = text.toLowerCase()
  const lowerPattern = pattern.toLowerCase()
  let patternIdx = 0

  for (let i = 0; i < lowerText.length && patternIdx < lowerPattern.length; i++) {
    if (lowerText[i] === lowerPattern[patternIdx]) {
      patternIdx++
    }
  }

  return patternIdx === lowerPattern.length
}
