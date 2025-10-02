import { describe, it, expect, beforeEach } from 'vitest'
import { beginSplitDrag, endSplitDrag, isSplitDragActive, resetSplitDragForTests } from '../splitDragCoordinator'

const CLASS_NAME = 'is-split-dragging'

describe('splitDragCoordinator', () => {
  beforeEach(() => {
    resetSplitDragForTests()
  })

  it('adds the split dragging class on first begin', () => {
    expect(document.body.classList.contains(CLASS_NAME)).toBe(false)

    beginSplitDrag('test')

    expect(document.body.classList.contains(CLASS_NAME)).toBe(true)
    expect(isSplitDragActive()).toBe(true)
  })

  it('maintains the class until all sources release it', () => {
    beginSplitDrag('first')
    beginSplitDrag('second')

    expect(document.body.classList.contains(CLASS_NAME)).toBe(true)

    endSplitDrag('first')

    expect(document.body.classList.contains(CLASS_NAME)).toBe(true)
    expect(isSplitDragActive()).toBe(true)

    endSplitDrag('second')

    expect(document.body.classList.contains(CLASS_NAME)).toBe(false)
    expect(isSplitDragActive()).toBe(false)
  })

  it('handles repeated begin calls from the same source', () => {
    beginSplitDrag('repeat')
    beginSplitDrag('repeat')

    expect(document.body.classList.contains(CLASS_NAME)).toBe(true)

    endSplitDrag('repeat')

    expect(document.body.classList.contains(CLASS_NAME)).toBe(true)

    endSplitDrag('repeat')

    expect(document.body.classList.contains(CLASS_NAME)).toBe(false)
  })

  it('is resilient to unmatched end calls', () => {
    beginSplitDrag('one-off')

    endSplitDrag('unknown')

    expect(document.body.classList.contains(CLASS_NAME)).toBe(true)

    endSplitDrag('one-off')

    expect(document.body.classList.contains(CLASS_NAME)).toBe(false)
  })
})
