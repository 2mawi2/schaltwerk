import { describe, expect, it } from 'vitest'

import { shouldStickToBottom } from './autoScroll'

const baseInput = {
  baseY: 200,
  viewportY: 199,
  isSearchVisible: false,
  isDraggingSelection: false,
  selectionActive: false,
  hasUserSelection: false,
}

describe('shouldStickToBottom', () => {
  it('returns true when viewport is within one line of the bottom and no selection is active', () => {
    expect(shouldStickToBottom(baseInput)).toBe(true)
  })

  it('returns false when the viewport is more than one line above the buffer bottom', () => {
    expect(
      shouldStickToBottom({
        ...baseInput,
        viewportY: 150,
      }),
    ).toBe(false)
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
