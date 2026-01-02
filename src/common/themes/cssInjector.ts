import type { ResolvedTheme } from './types'

export const applyThemeToDOM = (resolved: ResolvedTheme): void => {
  if (typeof document === 'undefined' || !document.documentElement) {
    return
  }

  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.setProperty('color-scheme', resolved)
}
