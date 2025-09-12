// Smart dash/quote normalization for text inputs
// Works alongside the app-scoped macOS preferences to ensure CLI arguments stay ASCII

export function normalizeSmartPunctuation(text: string): string {
  return text
    .replace(/[\u2014]/g, '--')  // em dash → --
    .replace(/[\u2013]/g, '-')   // en dash → -
    .replace(/[\u201C\u201D]/g, '"')  // curly double quotes → "
    .replace(/[\u2018\u2019]/g, "'")  // curly single quotes → '
}

export function containsSmartPunctuation(text: string): boolean {
  return /[\u2013\u2014\u2018\u2019\u201C\u201D]/.test(text)
}

export function installSmartDashGuards(root: Document = document): void {
  const shouldGuard = (el: Element | null): boolean => {
    return !!el && !el.closest('[data-smartdash-exempt="true"]')
  }

  // Handle typing that might trigger smart substitutions
  root.addEventListener('beforeinput', (e: Event) => {
    const event = e as InputEvent
    const target = event.target as HTMLElement | null
    if (!target || !shouldGuard(target)) return

    // Intercept text insertions that contain smart punctuation
    const data = event.data as string | null
    if (event.inputType === 'insertText' && data && containsSmartPunctuation(data)) {
      event.preventDefault()
      document.execCommand('insertText', false, normalizeSmartPunctuation(data))
    }
  }, { capture: true })

  // Handle paste events to normalize smart punctuation
  root.addEventListener('paste', (e: Event) => {
    const event = e as ClipboardEvent
    const target = event.target as HTMLElement | null
    if (!target || !shouldGuard(target)) return

    const text = event.clipboardData?.getData('text/plain')
    if (text && containsSmartPunctuation(text)) {
      event.preventDefault()
      document.execCommand('insertText', false, normalizeSmartPunctuation(text))
    }
  }, { capture: true })
}