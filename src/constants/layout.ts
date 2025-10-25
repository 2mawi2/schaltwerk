// Layout constants used to keep the HomeScreen sections vertically aligned

const TOP_BAR_HEIGHT = '32px'
const HOME_VIEW_MIN_HEIGHT = `calc(100vh - ${TOP_BAR_HEIGHT})`
const HOME_CONTAINER_PADDING_TOP = 'clamp(3rem, 10vh, 5.5rem)'
const HOME_CONTAINER_PADDING_X = 'clamp(1.5rem, 4vw, 3rem)'
const HOME_CONTAINER_PADDING_BOTTOM = 'clamp(3rem, 8vh, 4rem)'
const HOME_SECTION_GAP = 'clamp(2rem, 6vh, 3.5rem)'
const HOME_CONTAINER_MAX_WIDTH = '64rem'
const HOME_RECENT_SCROLL_MAX_HEIGHT = 'min(34rem, calc(100vh - 26rem))'

export const LAYOUT_CONSTANTS = {
  HOME_VIEW_MIN_HEIGHT,
  HOME_CONTAINER_PADDING_TOP,
  HOME_CONTAINER_PADDING_X,
  HOME_CONTAINER_PADDING_BOTTOM,
  HOME_SECTION_GAP,
  HOME_CONTAINER_MAX_WIDTH,
  HOME_RECENT_SCROLL_MAX_HEIGHT,
} as const

export const getHomeContainerStyles = () => ({
  minHeight: LAYOUT_CONSTANTS.HOME_VIEW_MIN_HEIGHT,
  width: '100%',
  maxWidth: LAYOUT_CONSTANTS.HOME_CONTAINER_MAX_WIDTH,
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  paddingTop: LAYOUT_CONSTANTS.HOME_CONTAINER_PADDING_TOP,
  paddingLeft: LAYOUT_CONSTANTS.HOME_CONTAINER_PADDING_X,
  paddingRight: LAYOUT_CONSTANTS.HOME_CONTAINER_PADDING_X,
  paddingBottom: LAYOUT_CONSTANTS.HOME_CONTAINER_PADDING_BOTTOM,
  gap: LAYOUT_CONSTANTS.HOME_SECTION_GAP,
})

export const getHomeLogoPositionStyles = () => ({
  width: '100%',
  display: 'flex',
  justifyContent: 'center',
})

export const getContentAreaStyles = () => ({
  width: '100%',
  display: 'flex',
  flexDirection: 'column' as const,
  alignSelf: 'stretch' as const,
  gap: LAYOUT_CONSTANTS.HOME_SECTION_GAP,
})
