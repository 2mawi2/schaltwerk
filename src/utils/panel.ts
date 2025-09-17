export function validatePanelPercentage(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue
  const numericValue = Number(value)
  return !Number.isNaN(numericValue) && numericValue > 0 && numericValue < 100 ? numericValue : defaultValue
}
