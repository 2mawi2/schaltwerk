/**
 * Sanitizes a display name to match the backend's sanitize_name function.
 * Converts to lowercase kebab-case, removes special characters, collapses
 * consecutive hyphens, and trims hyphens from start/end.
 *
 * @param input - The raw input string
 * @returns The sanitized string (max 30 chars)
 */
export function sanitizeName(input: string): string {
  const lowercased = input.toLowerCase()

  let withHyphens = ''
  for (const char of lowercased) {
    if (/[a-z0-9]/.test(char)) {
      withHyphens += char
    } else {
      withHyphens += '-'
    }
  }

  let collapsed = ''
  let prevHyphen = false
  for (const char of withHyphens) {
    if (char === '-') {
      if (!prevHyphen) {
        collapsed += '-'
      }
      prevHyphen = true
    } else {
      collapsed += char
      prevHyphen = false
    }
  }

  const trimmed = collapsed.replace(/^-+|-+$/g, '')

  return trimmed.slice(0, 30)
}

/**
 * Validates if a name will result in a valid sanitized name.
 * Returns an error message if invalid, or null if valid.
 */
export function validateDisplayName(input: string): string | null {
  const trimmed = input.trim()

  if (!trimmed) {
    return 'Name cannot be empty'
  }

  const sanitized = sanitizeName(trimmed)

  if (!sanitized) {
    return 'Name must contain at least one letter or number'
  }

  return null
}
