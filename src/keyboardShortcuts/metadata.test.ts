import { describe, it, expect } from 'vitest'
import { KEYBOARD_SHORTCUT_SECTIONS } from './metadata'
import { KeyboardShortcutAction } from './config'

const collectActions = (): KeyboardShortcutAction[] => {
  return KEYBOARD_SHORTCUT_SECTIONS.flatMap(section => section.items.map(item => item.action))
}

describe('keyboard shortcut metadata', () => {
  it('includes reset and switch model shortcuts in the catalog', () => {
    const actions = collectActions()

    expect(actions).toContain(KeyboardShortcutAction.ResetSessionOrOrchestrator)
    expect(actions).toContain(KeyboardShortcutAction.OpenSwitchModelModal)
  })
})
