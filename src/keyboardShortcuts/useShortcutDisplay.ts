import { useMemo } from 'react'
import { useKeyboardShortcutsConfig } from '../contexts/KeyboardShortcutsContext'
import { KeyboardShortcutAction } from './config'
import { detectPlatformSafe, getDisplayLabelForSegment, splitShortcutBinding } from './helpers'

/**
 * Hook to get the display string for a keyboard shortcut action.
 * Returns the formatted shortcut (e.g., "⌘T", "⌘<", "Ctrl+N") based on the current configuration.
 */
export function useShortcutDisplay(action: KeyboardShortcutAction): string {
  const keyboardShortcuts = useKeyboardShortcutsConfig()
  const platform = detectPlatformSafe()

  return useMemo(() => {
    const bindings = keyboardShortcuts.config[action]
    if (!bindings || bindings.length === 0) {
      // Return empty string if no binding exists
      return ''
    }

    // Use the first binding if multiple exist
    const binding = bindings[0]
    const segments = splitShortcutBinding(binding)
    return segments.map(seg => getDisplayLabelForSegment(seg, platform)).join('')
  }, [keyboardShortcuts.config, action, platform])
}

/**
 * Hook to get multiple shortcut displays at once for better performance.
 * Returns an object mapping actions to their display strings.
 */
export function useMultipleShortcutDisplays(actions: KeyboardShortcutAction[]): Record<KeyboardShortcutAction, string> {
  const keyboardShortcuts = useKeyboardShortcutsConfig()
  const platform = detectPlatformSafe()

  return useMemo(() => {
    const result = {} as Record<KeyboardShortcutAction, string>

    for (const action of actions) {
      const bindings = keyboardShortcuts.config[action]
      if (!bindings || bindings.length === 0) {
        result[action] = ''
        continue
      }

      const binding = bindings[0]
      const segments = splitShortcutBinding(binding)
      result[action] = segments.map(seg => getDisplayLabelForSegment(seg, platform)).join('')
    }

    return result
  }, [keyboardShortcuts.config, actions, platform])
}