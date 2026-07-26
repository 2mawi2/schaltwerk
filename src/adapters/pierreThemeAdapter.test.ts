import { describe, expect, it } from 'vitest'
import { getPierreUnsafeCSS, type SchaltwerkThemeId } from './pierreThemeAdapter'

const THEMES: SchaltwerkThemeId[] = [
  'dark',
  'light',
  'tokyonight',
  'catppuccin',
  'catppuccin-macchiato',
  'gruvbox',
  'everforest',
  'kanagawa',
  'ayu',
]

describe('getPierreUnsafeCSS', () => {
  it('does not apply content-visibility to [data-diffs] because it collapses the element to zero height inside shadow DOM without contain-intrinsic-size', () => {
    const css = getPierreUnsafeCSS('dark')
    expect(css).not.toContain('content-visibility')
  })

  it.each(THEMES)('keeps %s diff rows and gutters on the theme semantic surfaces', (theme) => {
    const css = getPierreUnsafeCSS(theme)

    expect(css).toContain('--diffs-computed-diff-line-bg: var(--color-diff-added-bg)')
    expect(css).toContain('--diffs-computed-diff-line-bg: var(--color-diff-removed-bg)')
    expect(css).toContain('--diffs-computed-diff-line-bg: var(--color-diff-added-gutter)')
    expect(css).toContain('--diffs-computed-diff-line-bg: var(--color-diff-removed-gutter)')
  })

  it.each(THEMES)(
    'renders %s partial-line highlights as final surfaces relative to the diff background',
    (theme) => {
      const css = getPierreUnsafeCSS(theme)

      expect(css).toContain(
        '--diffs-bg-addition-emphasis: color-mix(in srgb, var(--diffs-bg) 87%, var(--diffs-addition-base))'
      )
      expect(css).toContain(
        '--diffs-bg-deletion-emphasis: color-mix(in srgb, var(--diffs-bg) 87%, var(--diffs-deletion-base))'
      )
      expect(css).not.toContain(
        '--diffs-bg-addition-emphasis: var(--color-diff-added-text-bg)'
      )
      expect(css).not.toContain(
        '--diffs-bg-deletion-emphasis: var(--color-diff-removed-text-bg)'
      )
    }
  )
})
