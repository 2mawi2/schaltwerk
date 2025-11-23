import { sanitizeSplitSizes } from './splitStorage'

export function selectSplitRenderSizes(
  dragSizes: number[] | null,
  persisted: [number, number],
  defaults: [number, number]
): [number, number] {
  const candidate = Array.isArray(dragSizes) && dragSizes.length >= 2 ? dragSizes : persisted
  return sanitizeSplitSizes(candidate, defaults)
}

export function finalizeSplitCommit(params: {
  dragSizes: number[] | null
  nextSizes?: number[]
  defaults: [number, number]
  collapsed: boolean
}): [number, number] | null {
  if (params.collapsed) {
    return null
  }

  const candidate = Array.isArray(params.nextSizes) && params.nextSizes.length >= 2
    ? params.nextSizes
    : params.dragSizes

  if (!Array.isArray(candidate) || candidate.length < 2) {
    return null
  }

  return sanitizeSplitSizes(candidate, params.defaults)
}
