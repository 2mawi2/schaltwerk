import { describe, it, expect } from 'vitest'
import { Terminal } from './Terminal'

const REACT_MEMO_TYPE = Symbol.for('react.memo')

describe('Terminal memoization', () => {
  it('wraps the exported Terminal component in React.memo', () => {
    const actual = (Terminal as unknown as { $$typeof?: symbol }).$$typeof
    expect(actual).toBe(REACT_MEMO_TYPE)
  })
})
