import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDiffHover } from './useDiffHover'

describe('useDiffHover', () => {
  let mockOnStartComment: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockOnStartComment = vi.fn()
    // Clear any existing DOM
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.clearAllMocks()
    // Clean up any event listeners
    document.body.innerHTML = ''
  })

  it('should initialize with null hovered line', () => {
    const { result } = renderHook(() => useDiffHover())
    
    expect(result.current.hoveredLine).toBeNull()
  })

  it('should set hovered line info correctly', () => {
    const { result } = renderHook(() => useDiffHover())
    
    act(() => {
      result.current.setHoveredLineInfo(42, 'new', 'test-file.js')
    })

    expect(result.current.hoveredLine).toEqual({
      lineNum: 42,
      side: 'new',
      filePath: 'test-file.js'
    })
  })

  it('should clear hovered line with delay', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useDiffHover())
    
    act(() => {
      result.current.setHoveredLineInfo(42, 'new', 'test-file.js')
    })

    expect(result.current.hoveredLine).toEqual({
      lineNum: 42,
      side: 'new',
      filePath: 'test-file.js'
    })

    act(() => {
      result.current.clearHoveredLine()
    })

    // Should still be there immediately
    expect(result.current.hoveredLine).toEqual({
      lineNum: 42,
      side: 'new',
      filePath: 'test-file.js'
    })

    // After timeout, should be cleared
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.hoveredLine).toBeNull()

    vi.useRealTimers()
  })

  it('should cancel clear timeout when setting new hover info', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useDiffHover())
    
    act(() => {
      result.current.setHoveredLineInfo(42, 'new', 'test-file.js')
    })

    act(() => {
      result.current.clearHoveredLine()
    })

    // Set new info before timeout completes
    act(() => {
      result.current.setHoveredLineInfo(43, 'old', 'other-file.js')
    })

    // Should have new info, not be cleared
    expect(result.current.hoveredLine).toEqual({
      lineNum: 43,
      side: 'old',
      filePath: 'other-file.js'
    })

    // Even after timeout, should still have new info
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.hoveredLine).toEqual({
      lineNum: 43,
      side: 'old',
      filePath: 'other-file.js'
    })

    vi.useRealTimers()
  })

  it('should handle keyboard shortcuts when modal is open', () => {
    // Set up DOM for hover detection
    document.body.innerHTML = `
      <div data-testid="diff-modal" data-selected-file="test-file.js">
        <table>
          <tbody>
            <tr data-line-num="42" data-side="new" id="test-row">
              <td>test content</td>
            </tr>
          </tbody>
        </table>
      </div>
    `

    renderHook(() => {
      const hook = useDiffHover()
      hook.useHoverKeyboardShortcuts(mockOnStartComment, true)
      return hook
    })

    // Mock the :hover selector to return our test row
    const testRow = document.getElementById('test-row')
    const originalQuerySelector = document.querySelector
    vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      if (selector === 'tr:hover[data-line-num][data-side]') {
        return testRow
      }
      if (selector === '[data-testid="diff-modal"]') {
        return document.body.querySelector('[data-testid="diff-modal"]')
      }
      return originalQuerySelector.call(document, selector)
    })

    // Simulate Enter key press
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true
    })

    act(() => {
      document.dispatchEvent(enterEvent)
    })

    expect(mockOnStartComment).toHaveBeenCalledWith(42, 'new', 'test-file.js')
  })

  it('should not trigger on Enter when modal is closed', () => {
    renderHook(() => {
      const hook = useDiffHover()
      hook.useHoverKeyboardShortcuts(mockOnStartComment, false) // Modal closed
      return hook
    })

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true
    })

    act(() => {
      document.dispatchEvent(enterEvent)
    })

    expect(mockOnStartComment).not.toHaveBeenCalled()
  })

  it('should ignore Enter key when focus is on input elements', () => {
    document.body.innerHTML = `
      <div data-testid="diff-modal" data-selected-file="test-file.js">
        <input id="test-input" />
        <tr data-line-num="42" data-side="new" id="test-row">
          <td>test content</td>
        </tr>
      </div>
    `

    renderHook(() => {
      const hook = useDiffHover()
      hook.useHoverKeyboardShortcuts(mockOnStartComment, true)
      return hook
    })

    // Focus the input
    const input = document.getElementById('test-input') as HTMLInputElement
    input.focus()

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true
    })

    act(() => {
      document.dispatchEvent(enterEvent)
    })

    expect(mockOnStartComment).not.toHaveBeenCalled()
  })

  it('should ignore Enter key with modifier keys', () => {
    document.body.innerHTML = `
      <div data-testid="diff-modal" data-selected-file="test-file.js">
        <tr data-line-num="42" data-side="new" id="test-row">
          <td>test content</td>
        </tr>
      </div>
    `

    renderHook(() => {
      const hook = useDiffHover()
      hook.useHoverKeyboardShortcuts(mockOnStartComment, true)
      return hook
    })

    // Test Ctrl+Enter
    const ctrlEnterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })

    act(() => {
      document.dispatchEvent(ctrlEnterEvent)
    })

    expect(mockOnStartComment).not.toHaveBeenCalled()
  })

  it('should not trigger when no hovered line and DOM detection fails', () => {
    renderHook(() => {
      const hook = useDiffHover()
      hook.useHoverKeyboardShortcuts(mockOnStartComment, true)
      return hook
    })

    // No DOM element matches the hover selector and no fallback hover state
    vi.spyOn(document, 'querySelector').mockReturnValue(null)

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true
    })

    act(() => {
      document.dispatchEvent(enterEvent)
    })

    // Should not call the callback when neither DOM detection nor fallback state is available
    expect(mockOnStartComment).not.toHaveBeenCalled()
  })
})