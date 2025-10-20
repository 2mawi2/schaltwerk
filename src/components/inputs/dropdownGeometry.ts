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

interface DropdownGeometryBase {
  left: number
  width: number
  maxHeight: number
}

export interface DropdownGeometryBelow extends DropdownGeometryBase {
  placement: 'below'
  top: number
}

export interface DropdownGeometryAbove extends DropdownGeometryBase {
  placement: 'above'
  bottom: number
}

export type DropdownGeometry = DropdownGeometryAbove | DropdownGeometryBelow

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

  const safeVerticalLimit = Math.max(viewport.height - safeViewportPadding * 2, 0)
  const availableBelow = Math.max(
    viewport.height - anchorRect.bottom - verticalOffset - safeViewportPadding,
    0
  )
  const availableAbove = Math.max(anchorRect.top - verticalOffset - safeViewportPadding, 0)

  const shouldFlipAbove =
    (availableBelow < minimumViewportHeight && availableAbove > availableBelow) ||
    (availableBelow === 0 && availableAbove > 0)

  const placement: 'above' | 'below' = shouldFlipAbove ? 'above' : 'below'

  if (placement === 'below') {
    const top = clamp(
      anchorRect.bottom + verticalOffset,
      safeViewportPadding,
      viewport.height - safeViewportPadding
    )
    const maxHeight = clamp(
      Math.min(availableBelow, safeVerticalLimit),
      0,
      safeVerticalLimit
    )
    return { placement, top, left, width, maxHeight }
  }

  const bottom = clamp(
    viewport.height - anchorRect.top + verticalOffset,
    safeViewportPadding,
    viewport.height - safeViewportPadding
  )
  const maxHeight = clamp(
    Math.min(availableAbove, safeVerticalLimit),
    0,
    safeVerticalLimit
  )

  return { placement, bottom, left, width, maxHeight }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}
