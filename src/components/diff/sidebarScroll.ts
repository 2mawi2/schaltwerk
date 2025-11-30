export interface SidebarScrollSnapshot {
  scrollTop: number
}

/**
 * Capture the current scroll position of the sidebar diff container.
 * Returns null when no container is available so callers can safely skip restoration.
 */
export const captureSidebarScroll = (container: HTMLElement | null | undefined): SidebarScrollSnapshot | null => {
  if (!container) return null
  return { scrollTop: container.scrollTop }
}

/**
 * Restore a previously captured scroll position.
 * No-ops when either the container or snapshot is missing.
 */
export const restoreSidebarScroll = (
  container: HTMLElement | null | undefined,
  snapshot: SidebarScrollSnapshot | null
) => {
  if (!container || !snapshot) return
  container.scrollTop = snapshot.scrollTop
}
