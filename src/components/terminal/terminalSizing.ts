export const MIN_TERMINAL_COLUMNS = 2
export const MIN_TERMINAL_MEASURE_WIDTH_PX = 120
export const MIN_TERMINAL_MEASURE_HEIGHT_PX = 60
export const MIN_PROPOSED_COLUMNS = 8

export function calculateEffectiveColumns(proposedColumns: number): number {
  if (!Number.isFinite(proposedColumns)) {
    return MIN_TERMINAL_COLUMNS
  }

  const normalized = Math.max(Math.floor(proposedColumns), MIN_TERMINAL_COLUMNS)

  return normalized
}

export function isMeasurementTooSmall(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return true
  }

  return width < MIN_TERMINAL_MEASURE_WIDTH_PX || height < MIN_TERMINAL_MEASURE_HEIGHT_PX
}
