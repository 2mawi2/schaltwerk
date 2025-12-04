export const MIN_TERMINAL_COLUMNS = 2
export const MIN_TERMINAL_MEASURE_WIDTH_PX = 120
export const MIN_TERMINAL_MEASURE_HEIGHT_PX = 60
export const MIN_PROPOSED_COLUMNS = 8

export function proposeDimensionsWithDpr(
  measured: { width: number; height: number },
  actualCellWidth: number,
  actualCellHeight: number,
  devicePixelRatio: number,
): { cols: number; rows: number } | undefined {
  if (!Number.isFinite(actualCellWidth) || !Number.isFinite(actualCellHeight)) {
    return undefined
  }
  if (actualCellWidth <= 0 || actualCellHeight <= 0) {
    return undefined
  }
  const dpr = Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1
  const scaledWidth = measured.width * dpr
  const scaledHeight = measured.height * dpr
  const cols = Math.floor(scaledWidth / actualCellWidth)
  const rows = Math.floor(scaledHeight / actualCellHeight)
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
    return undefined
  }
  return { cols, rows }
}

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
