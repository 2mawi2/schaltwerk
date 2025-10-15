export type DropdownAlignment = 'left' | 'right' | 'stretch'

export interface ViewportSize {
  width: number
  height: number
}

export interface DropdownGeometryInput {
  anchorRect: DOMRect
  viewport: ViewportSize
  alignment: DropdownAlignment
  minWidth: number
  verticalOffset?: number
  safeViewportPadding?: number
  minimumViewportHeight?: number
}

export interface DropdownGeometry {
  top: number
  left: number
  width: number
  maxHeight: number
}

const DEFAULT_VERTICAL_OFFSET = 4
const DEFAULT_SAFE_PADDING = 8
const DEFAULT_MINIMUM_HEIGHT = 160

// Keep the dropdown fully visible even when the anchor is near the viewport edges.
export function calculateDropdownGeometry({
  anchorRect,
  viewport,
  alignment,
  minWidth,
  verticalOffset = DEFAULT_VERTICAL_OFFSET,
  safeViewportPadding = DEFAULT_SAFE_PADDING,
  minimumViewportHeight = DEFAULT_MINIMUM_HEIGHT
}: DropdownGeometryInput): DropdownGeometry {
  const clampedWidth = Math.max(minWidth, anchorRect.width)
  const maxWidthWithinViewport = Math.max(viewport.width - safeViewportPadding * 2, 0)
  const widthLimit = maxWidthWithinViewport === 0 ? clampedWidth : maxWidthWithinViewport
  const width = Math.min(clampedWidth, widthLimit)

  const maxLeft = Math.max(viewport.width - width - safeViewportPadding, safeViewportPadding)
  let left = alignment === 'right' ? anchorRect.right - width : anchorRect.left
  left = clamp(left, safeViewportPadding, maxLeft)

  let top = anchorRect.bottom + verticalOffset
  let maxHeight = viewport.height - top - safeViewportPadding

  if (maxHeight < minimumViewportHeight) {
    const availableAbove = anchorRect.top - safeViewportPadding
    if (availableAbove > maxHeight) {
      maxHeight = Math.max(minimumViewportHeight, availableAbove)
      top = Math.max(safeViewportPadding, anchorRect.top - maxHeight)
    } else {
      top = clamp(
        top,
        safeViewportPadding,
        viewport.height - safeViewportPadding
      )
      maxHeight = Math.max(
        minimumViewportHeight,
        viewport.height - top - safeViewportPadding
      )
    }
  }

  return { top, left, width, maxHeight }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}
