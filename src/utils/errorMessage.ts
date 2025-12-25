const DEFAULT_FALLBACK = 'An unknown error occurred'

export function extractErrorMessage(error: unknown, fallback: string = DEFAULT_FALLBACK): string {
  if (error instanceof Error) {
    const message = error.message?.trim()
    return message || fallback
  }

  if (typeof error === 'string') {
    const message = error.trim()
    return message || fallback
  }

  if (error && typeof error === 'object') {
    if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
      const message = ((error as { message: string }).message).trim()
      if (message) {
        return message
      }
    }
    if ('error' in error && typeof (error as { error?: unknown }).error === 'string') {
      const message = ((error as { error: string }).error).trim()
      if (message) {
        return message
      }
    }
  }

  return fallback
}
