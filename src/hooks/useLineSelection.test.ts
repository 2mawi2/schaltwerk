import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLineSelection } from './useLineSelection'

describe('useLineSelection', () => {
  const filePath = 'test-file'

  it('initializes with no selection', () => {
    const { result } = renderHook(() => useLineSelection())
    expect(result.current.selection).toBeNull()
  })

  it('selects single line on click', () => {
    const { result } = renderHook(() => useLineSelection())

    act(() => {
      result.current.handleLineClick(5, 'old', filePath)
    })

    expect(result.current.selection).toEqual({
      startLine: 5,
      endLine: 5,
      side: 'old',
      filePath
    })
  })

  it('extends selection with shift+click', () => {
    const { result } = renderHook(() => useLineSelection())

    act(() => {
      result.current.handleLineClick(5, 'new', filePath)
    })

    act(() => {
      const event = { shiftKey: true } as React.MouseEvent
      result.current.handleLineClick(10, 'new', filePath, event)
    })

    expect(result.current.selection).toEqual({
      startLine: 5,
      endLine: 10,
      side: 'new',
      filePath
    })
  })

  it('clears selection when clicking within selected range', () => {
    const { result } = renderHook(() => useLineSelection())

    act(() => {
      result.current.handleLineClick(5, 'old', filePath)
    })

    act(() => {
      const event = { shiftKey: true } as React.MouseEvent
      result.current.handleLineClick(10, 'old', filePath, event)
    })

    act(() => {
      result.current.handleLineClick(7, 'old', filePath)
    })

    expect(result.current.selection).toBeNull()
  })

  it('starts new selection when clicking different side or file', () => {
    const { result } = renderHook(() => useLineSelection())

    act(() => {
      result.current.handleLineClick(5, 'old', filePath)
    })

    act(() => {
      result.current.handleLineClick(10, 'new', filePath)
    })

    expect(result.current.selection).toEqual({
      startLine: 10,
      endLine: 10,
      side: 'new',
      filePath
    })

    act(() => {
      result.current.handleLineClick(3, 'new', 'other-file')
    })

    expect(result.current.selection).toEqual({
      startLine: 3,
      endLine: 3,
      side: 'new',
      filePath: 'other-file'
    })
  })

  it('extends selection using extendSelection', () => {
    const { result } = renderHook(() => useLineSelection())

    act(() => {
      result.current.extendSelection(5, 'old', filePath)
    })

    expect(result.current.selection).toEqual({
      startLine: 5,
      endLine: 5,
      side: 'old',
      filePath
    })

    act(() => {
      result.current.extendSelection(10, 'old', filePath)
    })

    expect(result.current.selection).toEqual({
      startLine: 5,
      endLine: 10,
      side: 'old',
      filePath
    })
  })

  it('clears selection', () => {
    const { result } = renderHook(() => useLineSelection())

    act(() => {
      result.current.handleLineClick(5, 'old', filePath)
    })

    act(() => {
      result.current.clearSelection()
    })

    expect(result.current.selection).toBeNull()
  })

  it('correctly identifies selected lines', () => {
    const { result } = renderHook(() => useLineSelection())

    act(() => {
      result.current.handleLineClick(5, 'old', filePath)
    })

    act(() => {
      const event = { shiftKey: true } as React.MouseEvent
      result.current.handleLineClick(10, 'old', filePath, event)
    })

    expect(result.current.isLineSelected(filePath, 5, 'old')).toBe(true)
    expect(result.current.isLineSelected(filePath, 7, 'old')).toBe(true)
    expect(result.current.isLineSelected(filePath, 10, 'old')).toBe(true)
    expect(result.current.isLineSelected(filePath, 4, 'old')).toBe(false)
    expect(result.current.isLineSelected(filePath, 11, 'old')).toBe(false)
    expect(result.current.isLineSelected(filePath, 7, 'new')).toBe(false)
    expect(result.current.isLineSelected(filePath, undefined, 'old')).toBe(false)
  })

  it('handles no selection in isLineSelected', () => {
    const { result } = renderHook(() => useLineSelection())
    expect(result.current.isLineSelected(filePath, 5, 'old')).toBe(false)
  })

  it('checks if line is in range only for same file', () => {
    const { result } = renderHook(() => useLineSelection())

    act(() => {
      result.current.handleLineClick(5, 'old', filePath)
    })

    act(() => {
      const event = { shiftKey: true } as React.MouseEvent
      result.current.handleLineClick(10, 'old', filePath, event)
    })

    expect(result.current.isLineInRange(filePath, 7)).toBe(true)
    expect(result.current.isLineInRange(filePath, 3)).toBe(false)
    expect(result.current.isLineInRange(filePath, undefined)).toBe(false)

    // Different file should be ignored
    expect(result.current.isLineInRange('other-file', 7)).toBe(false)
  })
})
