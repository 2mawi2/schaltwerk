import { describe, expect, it } from 'vitest'
import { getPierreUnsafeCSS } from './pierreThemeAdapter'

describe('getPierreUnsafeCSS', () => {
  it('does not apply content-visibility to [data-diffs] because it collapses the element to zero height inside shadow DOM without contain-intrinsic-size', () => {
    const css = getPierreUnsafeCSS('dark')
    expect(css).not.toContain('content-visibility')
  })
})
