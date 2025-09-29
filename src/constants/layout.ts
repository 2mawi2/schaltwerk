// Layout constants used to keep the HomeScreen logo and content aligned with the top bar

export const LAYOUT_CONSTANTS = {
  HOME_LOGO_CENTER_TOP_VH: 'calc(32px + 30vh - 9.6px - 20px)',
  HOME_CONTENT_TOP_VH: 'calc(32px + 31vh - 9.9px)',
} as const

/**
 * Helper function for HOME SCREEN logo positioning  
 * Positions logo lower with content integration
 */
export const getHomeLogoPositionStyles = () => ({
  position: 'absolute' as const,
  top: LAYOUT_CONSTANTS.HOME_LOGO_CENTER_TOP_VH,
  left: 0,
  right: 0,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 10,
})

/**
 * Helper function to get consistent content area styles
 * Accounts for TopBar height and logo positioning
 */
export const getContentAreaStyles = () => ({
  position: 'absolute' as const,
  top: LAYOUT_CONSTANTS.HOME_CONTENT_TOP_VH,
  left: 0,
  right: 0,
  bottom: 0,
  overflowY: 'auto' as const,
})
