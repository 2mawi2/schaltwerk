import { describe, expect, it } from 'vitest'
import { serializeArg, serializeArgs } from './logger'

describe('serializeArg', () => {
  it('serializes Error with metadata', () => {
    const error = new Error('boom') as Error & { code?: number }
    error.code = 500

    const result = serializeArg(error)

    expect(result).toMatchObject({
      type: 'Error',
      name: 'Error',
      message: 'boom'
    })
    expect((result as Record<string, unknown>).code).toBe(500)
    expect((result as Record<string, unknown>).stack).toBeTypeOf('string')
  })

  it('serializes Maps and Sets with entries', () => {
    const map = new Map<string, unknown>([
      ['a', 1],
      ['b', { nested: true }]
    ])
    const set = new Set<unknown>(['x', 2])

    const result = serializeArg({ map, set }) as Record<string, unknown>

    expect(result.map).toEqual({
      type: 'Map',
      entries: [['a', 1], ['b', { nested: true }]]
    })
    expect(result.set).toEqual({
      type: 'Set',
      values: ['x', 2]
    })
  })

  it('detects circular references without throwing', () => {
    const obj: Record<string, unknown> = { label: 'root' }
    obj.self = obj

    const result = serializeArg(obj) as Record<string, unknown>

    expect(result.self).toContain('Circular')
  })

  it('sorts object keys deterministically', () => {
    const payload = { b: 1, a: { d: 4, c: 3 } }

    const result = serializeArg(payload) as Record<string, unknown>

    expect(Object.keys(result)).toEqual(['a', 'b'])
    expect(Object.keys(result.a as Record<string, unknown>)).toEqual(['c', 'd'])
  })

  it('serializes BigInt and dates', () => {
    const date = new Date('2024-01-02T03:04:05.000Z')

    const result = serializeArg({ value: 12n, date }) as Record<string, unknown>

    expect(result.value).toBe('12n')
    expect(result.date).toBe('2024-01-02T03:04:05.000Z')
  })
})

describe('serializeArgs', () => {
  it('produces JSON string for arrays of values', () => {
    const result = serializeArgs([{ x: 1 }, 'ok'])
    expect(JSON.parse(result)).toEqual([{ x: 1 }, 'ok'])
  })

  it('truncates oversized payloads', () => {
    const huge = 'a'.repeat(9000)
    const result = serializeArgs([huge])

    expect(result).toContain('[truncated]')
    expect(result.length).toBeLessThan(9050)
  })
})
