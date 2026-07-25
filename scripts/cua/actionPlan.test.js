import { describe, expect, it } from 'vitest'

import {
  buildDesktopOperations,
  encodeTextArgument,
  normalizeShortcut,
  resolveDragPoints,
} from './actionPlan.js'

describe('encodeTextArgument', () => {
  it('encodes UTF-8 text as base64', () => {
    expect(encodeTextArgument('hello Schaltwerk')).toBe('aGVsbG8gU2NoYWx0d2Vyaw==')
  })
})

describe('normalizeShortcut', () => {
  it('maps modifier chords to xdotool syntax', () => {
    expect(normalizeShortcut(['CMDORCTRL', 'Shift', 'P'])).toBe('ctrl+shift+p')
  })

  it('preserves repeated navigation keys as a sequence', () => {
    expect(normalizeShortcut(['TAB', 'TAB'])).toEqual(['Tab', 'Tab'])
  })
})

describe('resolveDragPoints', () => {
  it('supports drag paths', () => {
    expect(resolveDragPoints({ path: [{ x: 10, y: 20 }, { x: 40, y: 80 }] })).toEqual({
      startX: 10,
      startY: 20,
      endX: 40,
      endY: 80,
    })
  })
})

describe('buildDesktopOperations', () => {
  it('translates clicks, typing, shortcuts, scrolling, and dragging', () => {
    expect(
      buildDesktopOperations([
        { type: 'click', x: 10, y: 20, button: 'right' },
        { type: 'type', text: 'penguin' },
        { type: 'keypress', keys: ['CMDORCTRL', 'L'] },
        { type: 'scroll', x: 15, y: 25, scrollY: 240 },
        { type: 'drag', path: [{ x: 1, y: 2 }, { x: 11, y: 12 }] },
        { type: 'screenshot' },
      ])
    ).toEqual([
      { command: 'click', args: ['10', '20', 'right'] },
      { command: 'type', args: ['cGVuZ3Vpbg=='] },
      { command: 'keypress', args: ['ctrl+l'] },
      { command: 'scroll', args: ['15', '25', '0', '240'] },
      { command: 'drag', args: ['1', '2', '11', '12'] },
    ])
  })
})
