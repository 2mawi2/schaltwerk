import { describe, it, expect } from 'vitest'
import { computeUnifiedDiff, addCollapsibleSections } from './diff'

function generateText(lines: number, changeEveryN?: number) {
  const arr: string[] = []
  for (let i = 0; i < lines; i++) {
    const changed = changeEveryN && i % changeEveryN === 0
    arr.push(changed ? `line ${i} changed ${Math.random().toString(36).slice(2)}` : `line ${i}`)
  }
  return arr.join('\n') + '\n'
}

// Note: These are micro-bench style tests asserting upper bounds so they fail on regressions.
// Keep limits generous for CI variability.

describe('diff utils performance', () => {
  it('computeUnifiedDiff on large mostly-unchanged file is fast', () => {
    const a = generateText(50000)
    const b = generateText(50000)
    const start = performance.now()
    const res = computeUnifiedDiff(a, b)
    const elapsed = performance.now() - start
    // Should finish well under 500ms on modern machines; CI margin 1500ms
    expect(res.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(1500)
  })

  it('addCollapsibleSections handles long unchanged stretches efficiently', () => {
    const a = generateText(100000)
    const b = a
    const base = computeUnifiedDiff(a, b)
    const start = performance.now()
    const collapsed = addCollapsibleSections(base)
    const elapsed = performance.now() - start
    expect(collapsed.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(800)
  })


})
