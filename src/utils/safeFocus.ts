export const safeTerminalFocus = (
  focusAction: () => void,
  isAnyModalOpen: () => boolean
) => {
  requestAnimationFrame(() => {
    const bodyHasModal = typeof document !== 'undefined' && document.body.classList.contains('modal-open')
    if (!isAnyModalOpen() && !bodyHasModal) {
      focusAction()
    }
  })
}

export const safeTerminalFocusImmediate = (
  focusAction: () => void,
  isAnyModalOpen: () => boolean
) => {
  const bodyHasModal = typeof document !== 'undefined' && document.body.classList.contains('modal-open')
  if (!isAnyModalOpen() && !bodyHasModal) {
    focusAction()
  }
}
