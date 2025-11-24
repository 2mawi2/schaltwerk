import { describe, it, expect } from 'vitest'

import {
  isMeasurementTooSmall,
  MIN_TERMINAL_MEASURE_WIDTH_PX,
  MIN_TERMINAL_MEASURE_HEIGHT_PX,
} from './terminalSizing'

describe('terminalSizing guards', () => {
  it('flags measurements that are narrower or shorter than the safe threshold', () => {
    expect(isMeasurementTooSmall(MIN_TERMINAL_MEASURE_WIDTH_PX - 1, 200)).toBe(true)
    expect(isMeasurementTooSmall(200, MIN_TERMINAL_MEASURE_HEIGHT_PX - 1)).toBe(true)
  })

  it('allows measurements that meet or exceed the safe threshold', () => {
    expect(isMeasurementTooSmall(MIN_TERMINAL_MEASURE_WIDTH_PX, MIN_TERMINAL_MEASURE_HEIGHT_PX)).toBe(false)
    expect(isMeasurementTooSmall(MIN_TERMINAL_MEASURE_WIDTH_PX + 10, MIN_TERMINAL_MEASURE_HEIGHT_PX + 10)).toBe(false)
  })
})
