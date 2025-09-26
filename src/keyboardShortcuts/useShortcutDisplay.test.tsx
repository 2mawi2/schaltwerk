import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useShortcutDisplay, useMultipleShortcutDisplays } from './useShortcutDisplay'
import { KeyboardShortcutAction } from './config'
// KeyboardShortcutsProvider mocked below

// Mock the context to provide test data
vi.mock('../contexts/KeyboardShortcutsContext', () => ({
  KeyboardShortcutsProvider: ({ children }: { children: React.ReactNode }) => children,
  useKeyboardShortcutsConfig: () => ({
    config: {
      [KeyboardShortcutAction.FocusTerminal]: ['Mod+/'],
      [KeyboardShortcutAction.NewSession]: ['Mod+N'],
      [KeyboardShortcutAction.NewSpec]: ['Mod+Shift+N'],
      [KeyboardShortcutAction.FocusClaude]: ['Mod+T'],
    },
    loading: false,
    setConfig: vi.fn(),
    applyOverrides: vi.fn(),
    resetToDefaults: vi.fn(),
    refresh: vi.fn(),
  })
}))

// Mock platform detection to return mac for consistent symbols
vi.mock('./helpers', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    detectPlatformSafe: () => 'mac'
  }
})

describe('useShortcutDisplay', () => {
  it('returns formatted shortcut for single action', () => {
    const { result } = renderHook(() => useShortcutDisplay(KeyboardShortcutAction.FocusTerminal))
    expect(result.current).toBe('⌘/')
  })

  it('returns formatted shortcut with shift symbol', () => {
    const { result } = renderHook(() => useShortcutDisplay(KeyboardShortcutAction.NewSpec))
    expect(result.current).toBe('⌘⇧N')
  })

  it('returns empty string for action with no binding', () => {
    const { result } = renderHook(() => useShortcutDisplay(KeyboardShortcutAction.IncreaseFontSize))
    expect(result.current).toBe('')
  })
})

describe('useMultipleShortcutDisplays', () => {
  it('returns formatted shortcuts for multiple actions', () => {
    const actions = [
      KeyboardShortcutAction.FocusTerminal,
      KeyboardShortcutAction.NewSession,
      KeyboardShortcutAction.FocusClaude
    ]

    const { result } = renderHook(() => useMultipleShortcutDisplays(actions))

    expect(result.current).toEqual({
      [KeyboardShortcutAction.FocusTerminal]: '⌘/',
      [KeyboardShortcutAction.NewSession]: '⌘N',
      [KeyboardShortcutAction.FocusClaude]: '⌘T',
    })
  })

  it('returns empty string for actions with no bindings', () => {
    const actions = [KeyboardShortcutAction.IncreaseFontSize]

    const { result } = renderHook(() => useMultipleShortcutDisplays(actions))

    expect(result.current).toEqual({
      [KeyboardShortcutAction.IncreaseFontSize]: '',
    })
  })
})