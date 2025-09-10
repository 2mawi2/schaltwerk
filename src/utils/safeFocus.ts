export const safeTerminalFocus = (
  focusAction: () => void,
  isAnyModalOpen: () => boolean
) => {
  requestAnimationFrame(() => {
    if (!isAnyModalOpen()) {
      focusAction()
    }
  })
}

export const safeTerminalFocusImmediate = (
  focusAction: () => void,
  isAnyModalOpen: () => boolean
) => {
  if (!isAnyModalOpen()) {
    focusAction()
  }
}