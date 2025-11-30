import { describe, it, expect } from 'vitest'
import { captureSidebarScroll, restoreSidebarScroll } from './sidebarScroll'

describe('sidebarScroll helpers', () => {
  it('captures and restores scrollTop', () => {
    const container = document.createElement('div')
    container.scrollTop = 150

    const snapshot = captureSidebarScroll(container)
    // simulate scroll jump
    container.scrollTop = 10

    restoreSidebarScroll(container, snapshot)

    expect(container.scrollTop).toBe(150)
  })

  it('returns null when container is missing', () => {
    const snapshot = captureSidebarScroll(null)
    expect(snapshot).toBeNull()
  })

  it('does nothing when no snapshot is provided', () => {
    const container = document.createElement('div')
    container.scrollTop = 42

    restoreSidebarScroll(container, null)

    expect(container.scrollTop).toBe(42)
  })
})
