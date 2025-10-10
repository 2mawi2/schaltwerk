export function formatBytes(bytes: number | null | undefined): string {
  if (!Number.isFinite(bytes as number) || bytes === null || bytes === undefined) {
    return '0 B'
  }

  const safeBytes = Math.max(0, Math.floor(bytes))
  if (safeBytes < 1024) {
    return `${safeBytes} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB', 'PB', 'EB'] as const
  let value = safeBytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value < 10 ? 1 : 0
  const formatted = precision > 0
    ? Number.parseFloat(value.toFixed(precision)).toString()
    : Math.round(value).toString()

  return `${formatted} ${units[unitIndex]}`
}
