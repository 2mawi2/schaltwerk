export interface StickToBottomInput {
  baseY: number
  viewportY: number
  isSearchVisible: boolean
  isDraggingSelection: boolean
  selectionActive: boolean
  hasUserSelection: boolean
  toleranceLines?: number
}

export function shouldStickToBottom({
  baseY,
  viewportY,
  isSearchVisible,
  isDraggingSelection,
  selectionActive,
  hasUserSelection,
  toleranceLines,
}: StickToBottomInput): boolean {
  const distance = baseY - viewportY
  const tolerance =
    typeof toleranceLines === 'number' && Number.isFinite(toleranceLines) && toleranceLines > 0
      ? toleranceLines
      : 0
  if (!Number.isFinite(distance)) {
    return false
  }
  if (distance > tolerance) {
    return false
  }
  if (isSearchVisible) {
    return false
  }
  if (isDraggingSelection) {
    return false
  }
  if (selectionActive) {
    return false
  }
  if (hasUserSelection) {
    return false
  }
  return true
}
