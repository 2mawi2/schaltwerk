export type DateInput = Date | string | number | null | undefined

const MS_THRESHOLD = 1_000_000_000_000

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime())
}

export function normalizeDateInput(input: DateInput): Date | null {
  if (input === null || input === undefined) {
    return null
  }

  if (input instanceof Date) {
    return isValidDate(input) ? input : null
  }

  if (typeof input === 'number') {
    const timestamp = input > MS_THRESHOLD ? input : input * 1000
    const date = new Date(timestamp)
    return isValidDate(date) ? date : null
  }

  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) {
      return null
    }

    const date = new Date(trimmed)
    return isValidDate(date) ? date : null
  }

  return null
}

export function formatDateTime(
  input: DateInput,
  options?: Intl.DateTimeFormatOptions,
  fallback = 'Unknown',
  locale?: string | string[]
): string {
  const date = normalizeDateInput(input)
  if (!date) {
    return fallback
  }

  try {
    return options ? date.toLocaleString(locale, options) : date.toLocaleString(locale)
  } catch {
    return fallback
  }
}
