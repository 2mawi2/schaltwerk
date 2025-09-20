const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export type RgbTuple = [number, number, number]

export const hexToRgb = (hex: string): RgbTuple => {
  if (!HEX_PATTERN.test(hex)) {
    throw new Error(`Invalid hex color: ${hex}`)
  }

  const normalized = hex.slice(1)
  const expanded = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized

  const r = parseInt(expanded.slice(0, 2), 16)
  const g = parseInt(expanded.slice(2, 4), 16)
  const b = parseInt(expanded.slice(4, 6), 16)

  return [r, g, b]
}

export const withOpacity = (hex: string, alpha: number): string => {
  if (alpha < 0 || alpha > 1) {
    throw new Error(`Opacity must be between 0 and 1. Received: ${alpha}`)
  }

  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export const formatRgbTuple = ([r, g, b]: RgbTuple): string => `${r} ${g} ${b}`
