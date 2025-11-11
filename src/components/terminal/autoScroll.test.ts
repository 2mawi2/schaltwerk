import { describe, expect, it } from 'vitest'

import { shouldStickToBottom } from './autoScroll'

const baseInput = {
  baseY: 200,
  viewportY: 200,
  isSearchVisible: false,
  isDraggingSelection: false,
  selectionActive: false,
  hasUserSelection: false,
}

describe('shouldStickToBottom', () => {
  it('returns true when viewport is exactly at the buffer base and no selection is active', () => {
    expect(shouldStickToBottom(baseInput)).toBe(true)
  })

  it('returns false when the viewport is even a single line above the buffer bottom', () => {
    expect(
      shouldStickToBottom({
        ...baseInput,
        viewportY: 199,
      }),
    ).toBe(false)
  })

  it('returns false when the viewport is more than one line above the buffer bottom', () => {
    expect(
      shouldStickToBottom({
        ...baseInput,
        viewportY: 150,
      }),
    ).toBe(false)
  })

  it('allows a tolerance threshold when provided', () => {
    expect(
      shouldStickToBottom({
        ...baseInput,
        viewportY: 199,
        toleranceLines: 1,
      }),
    ).toBe(true)
  })

  it('returns false when any selection modality is active', () => {
    expect(
      shouldStickToBottom({
        ...baseInput,
        isSearchVisible: true,
      }),
    ).toBe(false)
    expect(
      shouldStickToBottom({
        ...baseInput,
        isDraggingSelection: true,
      }),
    ).toBe(false)
    expect(
      shouldStickToBottom({
        ...baseInput,
        selectionActive: true,
      }),
    ).toBe(false)
    expect(
      shouldStickToBottom({
        ...baseInput,
        hasUserSelection: true,
      }),
    ).toBe(false)
  })
})
