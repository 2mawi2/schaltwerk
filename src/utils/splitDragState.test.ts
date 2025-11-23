import { describe, it, expect } from 'vitest'
import { selectSplitRenderSizes, finalizeSplitCommit } from './splitDragState'

const defaults: [number, number] = [20, 80]

describe('selectSplitRenderSizes', () => {
  it('prefers live drag sizes when present', () => {
    expect(selectSplitRenderSizes([10, 90], [30, 70], defaults)).toEqual([10, 90])
  })

  it('falls back to persisted sizes when no drag is active', () => {
    expect(selectSplitRenderSizes(null, [30, 70], defaults)).toEqual([30, 70])
  })

  it('sanitizes invalid drag input and still returns a usable pair', () => {
    expect(selectSplitRenderSizes([0, 0], [30, 70], defaults)).toEqual(defaults)
  })
})

describe('finalizeSplitCommit', () => {
  it('uses nextSizes when provided', () => {
    const result = finalizeSplitCommit({
      dragSizes: [15, 85],
      nextSizes: [10, 90],
      defaults,
      collapsed: false,
    })
    expect(result).toEqual([10, 90])
  })

  it('falls back to dragSizes when nextSizes are missing', () => {
    const result = finalizeSplitCommit({
      dragSizes: [25, 75],
      defaults,
      collapsed: false,
    })
    expect(result).toEqual([25, 75])
  })

  it('returns null when panel is collapsed', () => {
    const result = finalizeSplitCommit({
      dragSizes: [25, 75],
      defaults,
      collapsed: true,
    })
    expect(result).toBeNull()
  })

  it('sanitizes invalid input back to defaults', () => {
    const result = finalizeSplitCommit({
      dragSizes: [-5, 200],
      defaults,
      collapsed: false,
    })
    expect(result).toEqual(defaults)
  })
})
