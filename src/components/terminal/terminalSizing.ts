export const MIN_TERMINAL_COLUMNS = 2

export function calculateEffectiveColumns(proposedColumns: number): number {
  if (!Number.isFinite(proposedColumns)) {
    return MIN_TERMINAL_COLUMNS
  }

  const normalized = Math.max(Math.floor(proposedColumns), MIN_TERMINAL_COLUMNS)

  return normalized
}
