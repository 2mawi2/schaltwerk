import { describe, expect, test } from 'vitest'
import { calculateDropdownGeometry } from './dropdownGeometry'

const viewport = { width: 1440, height: 900 }

describe('calculateDropdownGeometry', () => {
  test('positions menu below anchor when there is space', () => {
    const anchor = new DOMRect(100, 100, 200, 40)

    const geometry = calculateDropdownGeometry({
      anchorRect: anchor,
      viewport,
      alignment: 'left',
      minWidth: 160
    })

    expect(geometry.top).toBe(144)
    expect(geometry.left).toBe(100)
    expect(geometry.width).toBe(200)
    expect(geometry.maxHeight).toBe(748)
  })

  test('flips menu above anchor when space below is limited', () => {
    const anchor = new DOMRect(200, 820, 180, 48)

    const geometry = calculateDropdownGeometry({
      anchorRect: anchor,
      viewport,
      alignment: 'left',
      minWidth: 160
    })

    expect(geometry.top).toBe(8)
    expect(geometry.maxHeight).toBeGreaterThanOrEqual(160)
  })

  test('clamps horizontal position within viewport padding for right aligned menus', () => {
    const anchor = new DOMRect(980, 200, 240, 40)

    const geometry = calculateDropdownGeometry({
      anchorRect: anchor,
      viewport: { width: 1200, height: 900 },
      alignment: 'right',
      minWidth: 160
    })

    expect(geometry.left).toBe(952)
    expect(geometry.width).toBe(240)
  })

  test('limits stretch width to available viewport space', () => {
    const anchor = new DOMRect(16, 120, 800, 40)

    const geometry = calculateDropdownGeometry({
      anchorRect: anchor,
      viewport: { width: 700, height: 900 },
      alignment: 'stretch',
      minWidth: 180
    })

    expect(geometry.width).toBe(684)
    expect(geometry.left).toBe(8)
  })

  test('supports taller minimum height when provided', () => {
    const anchor = new DOMRect(200, 780, 200, 40)

    const geometry = calculateDropdownGeometry({
      anchorRect: anchor,
      viewport,
      alignment: 'left',
      minWidth: 160,
      minimumViewportHeight: 220
    })

    expect(geometry.maxHeight).toBeGreaterThanOrEqual(220)
  })
})
