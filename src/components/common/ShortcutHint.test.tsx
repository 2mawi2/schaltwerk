import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShortcutHint } from './ShortcutHint'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'

// Mock the useShortcutDisplay hook
vi.mock('../../keyboardShortcuts/useShortcutDisplay', () => ({
  useShortcutDisplay: (action: KeyboardShortcutAction) => {
    const shortcuts: Record<KeyboardShortcutAction, string> = {
      [KeyboardShortcutAction.FocusTerminal]: '⌘/',
      [KeyboardShortcutAction.NewSession]: '⌘N',
      [KeyboardShortcutAction.NewSpec]: '⌘⇧N',
      [KeyboardShortcutAction.FocusClaude]: '⌘T',
    } as Record<KeyboardShortcutAction, string>
    return shortcuts[action] || ''
  }
}))

describe('ShortcutHint', () => {
  it('renders shortcut for given action', () => {
    render(<ShortcutHint action={KeyboardShortcutAction.FocusTerminal} />)
    expect(screen.getByText('⌘/')).toBeInTheDocument()
  })

  it('renders shortcut with shift symbol', () => {
    render(<ShortcutHint action={KeyboardShortcutAction.NewSpec} />)
    expect(screen.getByText('⌘⇧N')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(<ShortcutHint action={KeyboardShortcutAction.FocusTerminal} className="test-class" />)
    const element = screen.getByText('⌘/')
    expect(element).toHaveClass('test-class')
  })

  it('shows fallback when shortcut is not configured', () => {
    render(<ShortcutHint action={KeyboardShortcutAction.IncreaseFontSize} fallback="N/A" />)
    expect(screen.getByText('N/A')).toBeInTheDocument()
  })

  it('renders nothing when no shortcut and no fallback', () => {
    const { container } = render(<ShortcutHint action={KeyboardShortcutAction.IncreaseFontSize} />)
    expect(container.firstChild).toBeNull()
  })
})