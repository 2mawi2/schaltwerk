import { describe, expect, it } from 'vitest'
import {
  LAYOUT_CONSTANTS,
  getContentAreaStyles,
  getHomeContainerStyles,
  getHomeLogoPositionStyles
} from './layout'

describe('layout constants', () => {
  it('stacks home sections within a centered column', () => {
    const containerStyles = getHomeContainerStyles()
    const logoStyles = getHomeLogoPositionStyles()
    const contentStyles = getContentAreaStyles()

    expect(containerStyles.display).toBe('flex')
    expect(containerStyles.flexDirection).toBe('column')
    expect(containerStyles.minHeight).toBe(LAYOUT_CONSTANTS.HOME_VIEW_MIN_HEIGHT)
    expect(containerStyles.maxWidth).toBe(LAYOUT_CONSTANTS.HOME_CONTAINER_MAX_WIDTH)
    expect(containerStyles.margin).toBe('0 auto')
    expect(logoStyles.justifyContent).toBe('center')
    expect(contentStyles.display).toBe('flex')
    expect(contentStyles.alignSelf).toBe('stretch')
  })

  it('limits the recent projects scroll area for consistent first-row visibility', () => {
    expect(LAYOUT_CONSTANTS.HOME_RECENT_SCROLL_MAX_HEIGHT).toContain('calc(100vh')
    expect(LAYOUT_CONSTANTS.HOME_RECENT_SCROLL_MAX_HEIGHT.startsWith('min(')).toBe(true)
  })
})
