// Shared layout constants to ensure perfect alignment between EntryAnimation and HomeScreen

/**
 * Layout constants for different animation states
 * Entry animation and final HomeScreen have different optimal positioning
 */
export const LAYOUT_CONSTANTS = {
  // TopBar height that needs to be accounted for
  TOPBAR_HEIGHT_PX: 32,
  
  // ENTRY ANIMATION: Logo positioned higher for loading animation
  ENTRY_LOGO_TOP_PERCENTAGE: 35, // Above center
  ENTRY_LOGO_CENTER_TOP_VH: 'calc(35vh - 30px)', // Above center minus half logo height
  
  // HOME SCREEN: Logo and content very close together for cohesive feel
  HOME_LOGO_TOP_PERCENTAGE: 30,
  HOME_CONTENT_TOP_PERCENTAGE: 31, // Very close - only 1% gap
  
  // HomeScreen CSS values (accounting for TopBar)
  HOME_LOGO_TOP_VH: 'calc(32px + 30vh - 9.6px)',
  HOME_CONTENT_TOP_VH: 'calc(32px + 31vh - 9.9px)', // Very tight spacing
  HOME_LOGO_CENTER_TOP_VH: 'calc(32px + 30vh - 9.6px - 20px)',
  HOME_CONTENT_HEIGHT_VH: 'calc(100vh - 32px - 31vh + 9.9px)',
} as const

/**
 * Helper function for ENTRY ANIMATION logo positioning
 * Centers the logo in the full viewport during loading
 */
export const getEntryLogoPositionStyles = () => ({
  position: 'absolute' as const,
  top: LAYOUT_CONSTANTS.ENTRY_LOGO_CENTER_TOP_VH,
  left: 0,
  right: 0,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  zIndex: 20,
})

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