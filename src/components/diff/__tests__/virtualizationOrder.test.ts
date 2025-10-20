import { describe, expect, it } from 'vitest'
import { computeRenderOrder } from '../virtualization'

describe('computeRenderOrder', () => {
  it('prioritizes newly visible paths before previously visible ones', () => {
    const previous = ['a.ts', 'b.ts', 'c.ts']
    const prioritized = ['d.ts', 'b.ts']

    const result = computeRenderOrder(previous, prioritized, 10)

    expect(result).toEqual(['d.ts', 'b.ts', 'a.ts', 'c.ts'])
  })

  it('limits the resulting list while keeping most recent entries', () => {
    const previous = ['a.ts', 'b.ts', 'c.ts', 'd.ts']
    const prioritized = ['e.ts', 'f.ts', 'b.ts']

    const result = computeRenderOrder(previous, prioritized, 4)

    expect(result).toEqual(['e.ts', 'f.ts', 'b.ts', 'a.ts'])
  })

  it('ensures the output list contains unique paths only', () => {
    const previous = ['a.ts', 'b.ts', 'c.ts']
    const prioritized = ['b.ts', 'a.ts', 'b.ts', 'd.ts']

    const result = computeRenderOrder(previous, prioritized, 10)

    expect(result).toEqual(['b.ts', 'a.ts', 'd.ts', 'c.ts'])
  })
})
