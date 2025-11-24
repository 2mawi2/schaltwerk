import { describe, expect, it } from 'vitest'
import { serializeForBackend } from './logger'

describe('serializeForBackend', () => {
  it('serializes plain objects with sorted keys', () => {
    const output = serializeForBackend('message', [{ b: 1, a: 2 }])
    expect(output).toContain('"a":2')
    expect(output).toContain('"b":1')
  })

  it('includes error details', () => {
    const error = new Error('boom')
    const output = serializeForBackend('message', [error])
    expect(output).toContain('"message":"boom"')
    expect(output).toContain('"name":"Error"')
  })

  it('is circular safe', () => {
    const obj: { a: number; self?: unknown } = { a: 1 }
    obj.self = obj
    const output = serializeForBackend('message', [obj])
    expect(output).toContain('[Circular]')
  })

  it('truncates very long strings', () => {
    const long = 'x'.repeat(2001)
    const output = serializeForBackend('message', [long])
    expect(output).toContain('truncated')
    expect(output.length).toBeLessThan(2100)
  })
})
