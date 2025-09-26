import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { useShortcutDisplay } from '../../keyboardShortcuts/useShortcutDisplay'

interface ShortcutHintProps {
  action: KeyboardShortcutAction
  className?: string
  fallback?: string
}

/**
 * Reusable component to display keyboard shortcut hints.
 * Automatically shows the current configured shortcut for the given action.
 */
export function ShortcutHint({ action, className = '', fallback = '' }: ShortcutHintProps) {
  const shortcut = useShortcutDisplay(action)
  const displayText = shortcut || fallback

  if (!displayText) {
    return null
  }

  return (
    <span className={className}>
      {displayText}
    </span>
  )
}