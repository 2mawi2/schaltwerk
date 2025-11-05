export interface StickToBottomInput {
  baseY: number
  viewportY: number
  isSearchVisible: boolean
  isDraggingSelection: boolean
  selectionActive: boolean
  hasUserSelection: boolean
}

export function shouldStickToBottom({
  baseY,
  viewportY,
  isSearchVisible,
  isDraggingSelection,
  selectionActive,
  hasUserSelection,
}: StickToBottomInput): boolean {
  const distance = baseY - viewportY
  if (!Number.isFinite(distance)) {
    return false
  }
  if (distance > 0) {
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
